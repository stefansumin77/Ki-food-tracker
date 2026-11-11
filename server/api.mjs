import { apiJson, apiFailure, authenticatedUser, validateRequestOrigin, enforceRateLimit } from './security.mjs';
import { readImageRequest, detectFoods } from './vision.mjs';
import { handleProductRequest } from './products.mjs';

const ANALYSIS_ERRORS = {
  ai_busy: 'Die KI ist gerade ausgelastet. Bitte versuche es später erneut.',
  ai_unavailable: 'Der geschützte KI-Zugang ist derzeit nicht verfügbar. Bitte überprüfe die Einrichtung.',
  ai_provider_error: 'Die Fotoanalyse ist gerade nicht erreichbar. Bitte versuche es erneut.',
  incomplete_analysis: 'Die Analyse konnte nicht vollständig abgeschlossen werden. Bitte versuche es erneut.',
  invalid_analysis: 'Die Erkennung konnte nicht geprüft werden. Bitte versuche es mit einem deutlicheren Foto.',
  no_food_detected: 'Auf diesem Foto konnte kein Lebensmittel erkannt werden. Bitte fotografiere die Lebensmittel gut sichtbar.',
  analysis_timeout: 'Die Analyse hat zu lange gedauert. Bitte versuche es erneut.',
};

export async function handleApi(request, env = {}, ctx) {
  const path = new URL(request.url).pathname;
  const analysis = ['/api/analyze', '/api/fridge/analyze'].includes(path);
  const products = path === '/api/products' || path.startsWith('/api/products/') || path === '/api/foods';
  if (!analysis && !products && path !== '/api/config' && path !== '/api/session') return apiFailure('Diese Funktion wurde nicht gefunden.', 404, 'not_found');
  if (!validateRequestOrigin(request)) return apiFailure('Diese Anfrage ist nicht erlaubt.', 403, 'forbidden_origin');
  const method = analysis ? 'POST' : 'GET';
  if (request.method !== method) return apiFailure('Diese Anfrage wird nicht unterstützt.', 405, 'method_not_allowed', { allow: method });
  if (path === '/api/config') return apiJson({ aiAvailable: typeof env.OPENAI_API_KEY === 'string' && Boolean(env.OPENAI_API_KEY.trim()) });
  const userId = authenticatedUser(request, env);
  if (!userId) return apiFailure('Bitte melde dich an, um diese Funktion zu verwenden.', 401, 'authentication_required');
  const limited = await enforceRateLimit(env, userId, analysis ? 'ai' : products ? 'products' : 'session');
  if (limited) return limited;
  if (path === '/api/session') return apiJson({ userId });
  if (products) {
    try { return await handleProductRequest(request, env, ctx); }
    catch { return apiFailure('Die Lebensmitteldatenbank ist gerade nicht erreichbar. Bitte versuche es erneut.', 502, 'nutrition_provider_error'); }
  }
  if (typeof env.OPENAI_API_KEY !== 'string' || !env.OPENAI_API_KEY.trim()) return apiFailure('Die KI-Fotoanalyse ist noch nicht aktiviert. Ein geschützter KI-Zugang muss eingerichtet werden. Du kannst Lebensmittel bereits manuell erfassen.', 503, 'ai_not_configured');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return apiFailure('Bitte sende das Foto im unterstützten Format.', 415, 'unsupported_content_type');
  let parsed;
  try { parsed = await readImageRequest(request); }
  catch { return apiFailure('Das Foto konnte nicht gelesen werden. Bitte versuche es erneut.', 400, 'invalid_request'); }
  if (parsed.error) {
    const errors = {
      too_large: ['Das Foto ist zu groß. Bitte verwende ein Bild mit höchstens 5 MB.', 413],
      invalid_request: ['Die Anfrage konnte nicht gelesen werden. Bitte versuche es erneut.', 400],
      invalid_notes: ['Der Hinweis darf höchstens 1.000 Zeichen enthalten.', 400],
      invalid_image: ['Bitte lade ein gültiges JPEG-, PNG- oder WebP-Foto mit höchstens 5 MB hoch.', 400],
    };
    const [message, status] = errors[parsed.error] || errors.invalid_request;
    return apiFailure(message, status, parsed.error);
  }
  const detected = await detectFoods(parsed.body, env, path === '/api/fridge/analyze' ? 'fridge' : 'meal', request.signal);
  if (detected.error) return apiFailure(ANALYSIS_ERRORS[detected.error] || ANALYSIS_ERRORS.ai_provider_error, detected.status || 502, detected.error, detected.status === 429 ? { 'retry-after': '60' } : {});
  return apiJson(detected.result);
}
