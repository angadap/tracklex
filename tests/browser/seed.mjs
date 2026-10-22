const mem = {}; globalThis.localStorage = { getItem:k=>mem[k]??null, setItem:(k,v)=>{mem[k]=String(v)}, removeItem:k=>{delete mem[k]} };
const db = await import(new URL("../../src/lib/db.js", import.meta.url).href);
await db.ensureDemoAdmin(); await db.staffSignIn({username:"admin",password:"admin123"});
const T=(await db.saveTournament({sport:"table-tennis",name:"Warje Olympics 2026",season:2026,ageCutoff:"2026-10-01",startsOn:"2026-11-01"})).id;
const C=(await db.saveCategory({tournamentId:T,name:"Open",gender:"M",format:"singles",minAge:18,maxAge:45,fee:100})).id;
await db.signOut();
for (let i=0;i<8;i++){ await db.signUp({name:"Player "+i,mobile:"98765000"+String(i).padStart(2,"0"),pin:"4321"}); await db.savePlayer({name:"Player "+i,dob:"1996-05-10",gender:"M",society:"K",relation:"self"}); await db.register({playerId:db.getState().players.at(-1).id,categoryId:C}); await db.signOut(); }
process.stdout.write(JSON.stringify(mem));
