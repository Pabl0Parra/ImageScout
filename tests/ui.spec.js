import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{window.requests=[];window.saves=[];window.scout={settings:async()=>({hasKey:true,shortcut:'Alt+Space',downloads:'C:/Downloads'}),library:async()=>[],configure:async()=>({hasKey:true,shortcut:'Alt+Space'}),search:(q,id)=>new Promise(resolve=>window.requests.push({q,id,resolve})),save:async(args)=>{window.saves.push(args);return {record:{id:'saved',query:args.query,title:args.title,preview:'',path:'C:/Downloads/Monkey (1).png'}}},onFocus:()=>()=>{},hide:()=>{},reveal:()=>{}}});
 await page.goto('/');
});
test('parallel tabs retain results and filenames use submitted query',async({page})=>{
 const input=page.getByPlaceholder('Search Google Images…'); await input.fill('monkey');await input.press('Enter');await page.getByRole('button',{name:'New tab',exact:true}).click();await input.fill('forest');await input.press('Enter');
 await page.evaluate(()=>window.requests[0].resolve([{id:'a',title:'Monkey portrait',url:'https://example.com/a.png',thumbnail:''}]));
 await page.getByRole('tab',{name:/monkey/}).click();await expect(page.getByRole('button',{name:'Preview Monkey portrait'})).toBeVisible();await input.fill('changed draft');await page.getByRole('button',{name:'Save Monkey portrait',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.saves[0]?.query)).toBe('monkey');await page.getByRole('tab',{name:/Saved/}).click();await expect(page.getByRole('button',{name:'Preview Monkey portrait'})).toBeVisible();
});
test('stale search completion cannot overwrite newer results',async({page})=>{
 const input=page.getByPlaceholder('Search Google Images…');await input.fill('old');await input.press('Enter');await input.fill('new');await input.press('Enter');
 await page.evaluate(()=>{window.requests[1].resolve([{id:'new',title:'New result',url:'https://example.com/new',thumbnail:''}]);window.requests[0].resolve([{id:'old',title:'Old result',url:'https://example.com/old',thumbnail:''}])});
 await expect(page.getByRole('button',{name:'Preview New result'})).toBeVisible();await expect(page.getByRole('button',{name:'Preview Old result'})).toHaveCount(0);
});
test('saved preview reveals the original file and modal shortcuts do not create tabs',async({page})=>{
 await page.evaluate(()=>{window.revealed=[];window.scout.library=async()=>[{id:'saved',title:'Saved monkey',query:'monkey',path:'C:/Downloads/Monkey (1).png'}];window.scout.reveal=async id=>window.revealed.push(id);});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.keyboard.press('Control+t');await expect(page.getByRole('tab',{name:'New search'})).toHaveCount(1);await page.keyboard.press('Escape');
 const input=page.getByPlaceholder('Search Google Images…');await input.fill('monkey');await input.press('Enter');await page.evaluate(()=>window.requests[0].resolve([{id:'a',title:'Monkey portrait',url:'https://example.com/a.png',thumbnail:''}]));await page.getByRole('button',{name:'Save Monkey portrait',exact:true}).click();await page.getByRole('tab',{name:/Saved/}).click();await page.getByRole('button',{name:'Preview Monkey portrait'}).click();await page.getByRole('button',{name:'Show in Downloads',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.revealed)).toEqual(['saved']);
});
