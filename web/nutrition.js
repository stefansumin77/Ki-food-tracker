export const nutrientKeys = ['kcal','protein','carbs','fat','fiber','sugar'];
// Only source-verified rows belong here; see docs/nutrition-sources.md.
export const catalog = [
 {id:'rice-cooked',name:'Reis, weiß, Langkorn, gekocht',aliases:['Reis','weißer Reis','white rice','rice','cooked rice'],cookingMethod:'cooked',unit:'g',per100:{kcal:130,protein:2.69,carbs:28.17,fat:0.28,fiber:0.4,sugar:0.05},source:{name:'USDA FoodData Central · SR Legacy',url:'https://fdc.nal.usda.gov/food-details/168878/nutrients',recordId:'168878',license:'Public domain (USDA)'}},
 {id:'chicken-roasted',name:'Hähnchenbrust, ohne Haut, gegart',aliases:['Hähnchenbrust','chicken breast','roasted chicken breast'],cookingMethod:'roasted',unit:'g',per100:{kcal:165,protein:31.02,carbs:0,fat:3.57,fiber:0,sugar:0},source:{name:'USDA FoodData Central · SR Legacy',url:'https://fdc.nal.usda.gov/food-details/171477/nutrients',recordId:'171477',license:'Public domain (USDA)'}},
 {id:'lentils-cooked',name:'Linsen, gekocht, ohne Salz',aliases:['Linsen','lentils','cooked lentils'],cookingMethod:'cooked',unit:'g',per100:{kcal:116,protein:9.02,carbs:20.13,fat:0.38,fiber:7.9,sugar:1.8},source:{name:'USDA FoodData Central · SR Legacy',url:'https://fdc.nal.usda.gov/food-details/172421/nutrients',recordId:'172421',license:'Public domain (USDA)'}},
 {id:'tofu-raw',name:'Tofu, fest, mit Calciumsulfat',aliases:['Tofu','firm tofu','tofu firm'],cookingMethod:'raw',unit:'g',per100:{kcal:144,protein:17.27,carbs:2.78,fat:8.72,fiber:2.3,sugar:null},source:{name:'USDA FoodData Central · SR Legacy',url:'https://fdc.nal.usda.gov/food-details/172475/nutrients',recordId:'172475',license:'Public domain (USDA)'}}
];
const normalize = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,' ').trim();
const methodAliases = {raw:'raw',roh:'raw',ungekocht:'raw',cooked:'cooked',gekocht:'cooked',gedampft:'steamed',steamed:'steamed',gebraten:'fried',fried:'fried',gerostet:'roasted',roasted:'roasted',gebacken:'baked',baked:'baked',unbekannt:'unknown',unknown:'unknown','':'unknown'};
export function resolveFood(name,cookingMethod){
 const query=normalize(name);if(!query)return null;
 const matches=catalog.filter(food=>[food.id,food.name,...(food.aliases||[])].some(alias=>normalize(alias)===query));
 const method=methodAliases[normalize(cookingMethod)]||normalize(cookingMethod);
 if(method&&method!=='unknown'){const exact=matches.filter(food=>(methodAliases[normalize(food.cookingMethod)]||normalize(food.cookingMethod))===method);return exact.length===1?exact[0]:null;}
 return matches.length===1?matches[0]:null;
}
function validValue(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0;}
export function calculatePortion(food,grams){
 if(!food||typeof food!=='object'||!food.per100||!validValue(grams)||grams>100000)throw new TypeError('Ungültiges Lebensmittel oder Portionsgewicht.');
 const unit=food.unit||'g';if(!['g','ml'].includes(unit))throw new TypeError('Nicht unterstützte Einheit.');
 const result={grams:unit==='g'?grams:null,quantity:grams,unit};
 for(const key of nutrientKeys){const value=food.per100[key];result[key]=validValue(value)?Math.round(value*grams)/100:null;}
 return result;
}
export function sumPortions(rows){
 if(!Array.isArray(rows))throw new TypeError('Portionen müssen als Liste vorliegen.');
 const result={grams:0,...Object.fromEntries(nutrientKeys.map(key=>[key,0]))};
 for(const row of rows){if(!row||typeof row!=='object')throw new TypeError('Ungültige Portion.');for(const key of ['grams',...nutrientKeys]){if(result[key]===null)continue;const value=row[key];if(!validValue(value)){result[key]=null;continue;}result[key]+=value;}}
 for(const key of Object.keys(result))if(result[key]!==null)result[key]=Math.round(result[key]*100)/100;
 return result;
}
export function proteinPer100Kcal(food){const p=food?.per100?.protein,k=food?.per100?.kcal;return validValue(p)&&validValue(k)&&k>0?Math.round(p/k*10000)/100:null;}
export function compareProducts(product,candidates,remaining={},options={}){
 if(!product||!Array.isArray(candidates)||product.unit==='unknown'||product.per100Basis==='unknown'||product.nutritionBasis==='unknown')return[];const criterion=options.criterion||'fit';
 if(!['protein','calories','density','fit'].includes(criterion))throw new TypeError('Unbekanntes Vergleichskriterium.');
 const base=product.per100||{},unit=product.unit||'g';
 return candidates.filter(candidate=>candidate&&candidate.id!==product.id&&candidate.unit!=='unknown'&&candidate.per100Basis!=='unknown'&&candidate.nutritionBasis!=='unknown'&&(candidate.unit||'g')===unit).map(candidate=>{
  const n=candidate.per100||{},density=proteinPer100Kcal(candidate),complete=['kcal','protein','carbs','fat'].every(k=>validValue(n[k]));
  const metrics={proteinPer100g:unit==='g'&&validValue(n.protein)?n.protein:null,kcalPer100g:unit==='g'&&validValue(n.kcal)?n.kcal:null,proteinPer100Kcal:density,pricePerProteinServing:null};
  const reasons=[];if(validValue(n.protein)&&validValue(base.protein)&&n.protein>base.protein)reasons.push('Mehr Protein pro gleicher Menge');if(validValue(n.kcal)&&validValue(base.kcal)&&n.kcal<base.kcal)reasons.push('Weniger Kalorien pro gleicher Menge');
  let score=null;if(criterion==='protein'&&validValue(n.protein))score=n.protein;else if(criterion==='calories'&&validValue(n.kcal))score=-n.kcal;else if(criterion==='density'&&density!==null)score=density;else if(criterion==='fit'&&complete){const calorieTarget=Math.max(Number(remaining.kcal)||0,1),proteinTarget=Math.max(Number(remaining.protein)||0,1);score=100*(Math.min(n.protein/proteinTarget,1)-Math.max(n.kcal-calorieTarget,0)/calorieTarget);for(const key of ['carbs','fat'])if(validValue(remaining[key]))score-=25*Math.max(n[key]-remaining[key],0)/Math.max(remaining[key],1);}
  return {...candidate,comparison:{basis:unit==='g'?'100g':'100ml',criterion,metrics,score:score===null?null:Math.round(score*100)/100,reasons,complete},score:score===null?null:Math.round(score*100)/100};
 }).sort((a,b)=>a.score===null&&b.score===null?a.name.localeCompare(b.name,'de'):a.score===null?1:b.score===null?-1:b.score-a.score||a.name.localeCompare(b.name,'de'));
}
