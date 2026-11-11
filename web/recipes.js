import {catalog,calculatePortion,sumPortions} from './nutrition.js';
const recipeTemplates=[
 {id:'rice-chicken',name:'Reis mit Hähnchen',ingredients:[['rice-cooked',150],['chicken-roasted',120]],instructions:['Reis entsprechend der ausgewählten Zubereitungsart vorbereiten.','Hähnchen vollständig durchgaren und alles gemeinsam servieren.']},
 {id:'rice-lentil-bowl',name:'Reis-Linsen-Bowl',ingredients:[['rice-cooked',120],['lentils-cooked',150]],instructions:['Linsen und Reis garen.','In einer Schüssel servieren. Öl und Sauce bei Verwendung gesondert erfassen.']},
 {id:'yogurt-oats',name:'Joghurt mit Haferflocken',ingredients:[['yogurt-plain',200],['oats-raw',40]],instructions:['Joghurt und Haferflocken vermischen.','Weitere Zutaten separat erfassen.']},
 {id:'tofu-rice',name:'Tofu-Reis-Bowl',ingredients:[['tofu-raw',150],['rice-cooked',120]],instructions:['Reis garen.','Tofu nach Verpackungsangabe erhitzen, ohne nicht erfasstes Bratöl hinzuzufügen.']},
];
export function recommendRecipes(inventory,remaining={},options={}){
 if(!Array.isArray(inventory))return[];const confirmed=inventory.filter(row=>row?.confirmed===true);
 return recipeTemplates.map(template=>{
  const ingredients=template.ingredients.map(([foodId,grams])=>{const food=catalog.find(row=>row.id===foodId);if(!food)return null;const rows=confirmed.filter(row=>(row.foodId||row.food?.id)===foodId);const known=rows.filter(row=>typeof row.grams==='number'&&Number.isFinite(row.grams)&&row.grams>=0&&row.quantityEstimated!==true);const stock=known.reduce((s,row)=>s+row.grams,0);const quantityUnknown=rows.some(row=>row.grams===null||row.grams===undefined||row.quantityEstimated===true);const missingGrams=Math.max(0,Math.round((grams-stock)*10)/10);return {foodId,name:food.name,grams,food,available:stock>=grams,missingGrams,quantityUnknown,portion:calculatePortion(food,grams)};});
  if(ingredients.some(row=>!row))return null;const availableCount=ingredients.filter(row=>row.available).length,recognizedCount=ingredients.filter(row=>confirmed.some(stock=>(stock.foodId||stock.food?.id)===row.foodId)).length;
  if(!recognizedCount)return null;const macros=sumPortions(ingredients.map(row=>row.portion));if(['kcal','protein','carbs','fat'].some(key=>macros[key]===null))return null;
  const calorieTarget=Math.max(0,Number(remaining.kcal)||0),proteinTarget=Math.max(0,Number(remaining.protein)||0);const calorieFit=1-Math.min(Math.abs(macros.kcal-calorieTarget)/Math.max(calorieTarget,100),2);const proteinFit=proteinTarget>0?Math.min(macros.protein/proteinTarget,1):0;
  let score=recognizedCount*25+availableCount*15+calorieFit*20+proteinFit*30;if(['loss','fat_loss'].includes(options.goal)&&macros.kcal>calorieTarget)score-=20;if(['gain','muscle_gain'].includes(options.goal))score+=Math.min(macros.protein,40)/4;
  return {...template,ingredients,missingIngredients:ingredients.filter(row=>!row.available).map(({foodId,name,missingGrams,quantityUnknown})=>({foodId,name,grams:missingGrams,missingGrams,quantityUnknown})),macros,score:Math.round(score*100)/100,source:{name:'nouri Rezeptvorlage mit quellenbasierten Nährwerten',foods:ingredients.map(row=>row.food.source)},estimated:true};
 }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,Math.min(10,options.limit||5));
}
