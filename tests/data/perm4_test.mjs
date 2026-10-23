// Age is counted today; T-shirt size and photo are optional extras on a player.
const mem = {}; globalThis.localStorage = { getItem:k=>mem[k]??null, setItem:(k,v)=>{mem[k]=String(v)}, removeItem:k=>{delete mem[k]} };
const db = await import(new URL("../../src/lib/db.js", import.meta.url).href);
let pass=0, fail=0;
const is=(name,v,exp)=>{ const good=v===exp; good?pass++:fail++; console.log(good?"PASS":"FAIL", name, good?"":`got ${v} expected ${exp}`); };
const iso=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const dob=(years,plusDays)=>{ const d=new Date(); d.setFullYear(d.getFullYear()-years); d.setDate(d.getDate()+plusDays); return iso(d); };
is("age: birthday today", db.ageOn(dob(21,0)), 21);
is("age: birthday tomorrow", db.ageOn(dob(21,1)), 20);
is("age: birthday yesterday", db.ageOn(dob(21,-1)), 21);
await db.ensureDemoAdmin(); await db.staffSignIn({username:"admin",password:"admin123"});
const T=(await db.saveTournament({sport:"table-tennis",name:"T",season:2026})).id;   // no cutoff needed
is("tournament saved without a cutoff date", !!T, true);
const C=(await db.saveCategory({tournamentId:T,name:"Under 21",gender:"M",format:"singles",minAge:0,maxAge:20,fee:0})).id;
await db.signOut();
await db.signUp({name:"Parent",mobile:"9876500001",pin:"4321"});
await db.savePlayer({name:"Turned21",dob:dob(21,0),gender:"M",society:"",relation:"self"});
await db.savePlayer({name:"Turns21Tomorrow",dob:dob(21,1),gender:"M",society:"",relation:"child",tshirt:"M",photo:"data:image/jpeg;base64,AAAA"});
const [old,young]=db.getState().players;
is("turned 21 today is refused", (await db.register({playerId:old.id,categoryId:C})).ok, false);
is("turns 21 tomorrow is accepted", (await db.register({playerId:young.id,categoryId:C})).ok, true);
is("player without extras has empty tshirt", old.tshirt, "");
is("tshirt saved", young.tshirt, "M");
is("photo saved", young.photo.startsWith("data:image/"), true);
await db.savePlayer({id:young.id,name:"Turns21Tomorrow",dob:dob(21,1),gender:"M",society:"",relation:"child",tshirt:"",photo:""});
is("extras can be cleared", db.getState().players.find(p=>p.id===young.id).tshirt, "");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
