import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRecognition, normalizeRecognition, validateImage, readImageRequest } from '../server/vision.mjs';
import { catalog, calculatePortion } from '../web/nutrition.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYyQAAAAASUVORK5CYII=';
const recognition={name:'Reis mit Gemüse',note:'Menge bitte prüfen.',items:[{name:'unbekannte Frucht',grams:null,cookingMethod:'unbekannt',recognitionConfidence:'low',quantityConfidence:'low'}],questions:[{text:'Wurde Öl verwendet?',kind:'oil'}]};

test('vision schema rejects additional fields, numeric probabilities, invalid quantities and AI nutrition',()=>{
  assert.equal(validateRecognition(recognition),true);
  for(const result of [
    {...recognition,kcal:100},
    {...recognition,items:[{...recognition.items[0],kcal:100}]},
    {...recognition,items:[{...recognition.items[0],recognitionConfidence:0.98}]},
    {...recognition,items:[{...recognition.items[0],grams:-2}]},
    {...recognition,items:[{...recognition.items[0],grams:Infinity}]},
    {...recognition,questions:[{text:'x',kind:'invented'}]},
    {...recognition,items:new Array(31).fill(recognition.items[0])},
  ])assert.equal(validateRecognition(result),false);
});
test('unknown foods and quantities stay unresolved instead of receiving invented macros',()=>{
  const result=normalizeRecognition(recognition);
  assert.equal(result.schemaVersion,2);
  const item=result.items[0];assert.equal(item.foodId,null);assert.equal(item.per100,null);assert.equal(item.kcal,null);assert.equal(item.grams,null);
  assert.equal(item.recognitionConfidence,'needs_confirmation');assert.equal(item.quantityConfidence,'needs_confirmation');assert.equal(item.confirmed,false);assert.equal(item.quantityEstimated,true);
  assert.equal(result.questions[0].kind,'oil');
});
test('fridge output contains separate pending ingredients and meal output asks hidden calorie questions',()=>{
  const multiple={...recognition,items:[...recognition.items,{...recognition.items[0],name:'unbekannter Käse',grams:100,quantityConfidence:'medium'}],questions:[]};
  const fridge=normalizeRecognition(multiple,'fridge');assert.equal(fridge.items.length,2);assert.deepEqual(fridge.questions,[]);assert.notEqual(fridge.items[0].id,fridge.items[1].id);
  const meal=normalizeRecognition(multiple);assert.ok(meal.questions.some(q=>/Öl|Butter|Sauce|Dressing/.test(q.text)));
});
test('image validation checks real PNG/JPEG structures and rejects signatures-only, huge dimensions and wrong formats',()=>{
  assert.equal(validateImage(png),true);
  const jpeg='data:image/jpeg;base64,'+readFileSync(new URL('../web/assets/bowl.jpg',import.meta.url)).toString('base64');assert.equal(validateImage(jpeg),true);
  assert.equal(validateImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'),false);
  assert.equal(validateImage('data:image/png;base64,SGVsbG8='),false);
  const headerJpeg=Buffer.from([255,216,255,192,0,8,8,0,1,0,1,1,255,217]);
  assert.equal(validateImage('data:image/jpeg;base64,'+headerJpeg.toString('base64')),false);
  const headerWebp=Buffer.alloc(30);headerWebp.write('RIFF',0);headerWebp.writeUInt32LE(22,4);headerWebp.write('WEBP',8);headerWebp.write('VP8X',12);headerWebp.writeUInt32LE(10,16);
  assert.equal(validateImage('data:image/webp;base64,'+headerWebp.toString('base64')),false);
  assert.equal(validateImage('data:image/svg+xml;base64,PHN2Zz4='),false);
  const huge=Buffer.from(png.split(',')[1],'base64');huge.writeUInt32BE(99999,16);assert.equal(validateImage('data:image/png;base64,'+huge.toString('base64')),false);
});
test('request parser validates streamed size, strict keys, notes and null image',async()=>{
  const req=body=>new Request('https://nouri.example/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await readImageRequest(req({image:png}))).body.image,png);
  assert.equal((await readImageRequest(req({image:png,userId:'someone'}))).error,'invalid_request');
  assert.equal((await readImageRequest(req({image:null}))).error,'invalid_image');
  assert.equal((await readImageRequest(req({image:png,notes:'x'.repeat(1001)}))).error,'invalid_notes');
  const oversized=new Request('https://nouri.example/api/analyze',{method:'POST',headers:{'content-length':'8000000'},body:'{}'});assert.equal((await readImageRequest(oversized)).error,'too_large');
});

test('matched ingredients bind to a real reference row and deterministic portion math',()=>{
  assert.ok(catalog.length>0,'At least one sourced catalog row must ship');
  const food=catalog.find(row=>row.per100.kcal!==null);assert.ok(food);
  const result=normalizeRecognition({...recognition,items:[{name:food.name,grams:150,cookingMethod:food.cookingMethod,recognitionConfidence:'high',quantityConfidence:'low'}]});
  const item=result.items[0];assert.equal(item.foodId,food.id);assert.deepEqual(item.source,food.source);assert.deepEqual(item.per100,food.per100);
  assert.equal(item.kcal,calculatePortion(food,150).kcal);assert.equal(item.recognitionConfidence,'high');assert.equal(item.quantityConfidence,'low');assert.equal(item.confirmed,false);
});
