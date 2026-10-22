const mem = {}; globalThis.localStorage = { getItem:k=>mem[k]??null, setItem:(k,v)=>{mem[k]=String(v)}, removeItem:k=>{delete mem[k]} };
const db = await import(new URL("../../src/lib/db.js", import.meta.url).href);
let pass=0, fail=0;
const t=(name,res,expectOk)=>{ const good=(res.ok===expectOk); good?pass++:fail++; console.log(good?"PASS":"FAIL", name, res.ok?"(allowed)":"("+res.error+")"); };
const ALL=["categories","entries","draws","scores"];
await db.ensureDemoAdmin();
let TID=null; const STG=(c)=>db.getState().stages.find(x=>x.categoryId===c)?.id;
// ---- admin sets things up
t("admin signs in", await db.staffSignIn({username:"admin",password:"admin123"}), true);
TID=(await db.saveTournament({sport:"table-tennis",name:"Warje Olympics 2026",season:2026,ageCutoff:"2026-10-01"})).id;
t("admin creates TT organiser", await db.saveOrganiser({name:"TT Organiser",username:"tt_org",password:"OrgPass123",sport:"table-tennis",perms:ALL}), true);
t("admin cannot assign a sport that is not set up", await db.saveOrganiser({name:"BD",username:"bd_org",password:"OrgPass123",sport:"badminton",perms:ALL}), false);
t("duplicate organiser username rejected", await db.saveOrganiser({name:"Dup",username:"TT_ORG",password:"OrgPass123",sport:"table-tennis",perms:ALL}), false);
t("short organiser password rejected", await db.saveOrganiser({name:"X",username:"x_org",password:"short",sport:"table-tennis",perms:ALL}), false);
t("admin adds starter categories", await db.addStarterCategories(TID), true);
// inject a badminton category + a badminton organiser (UI cannot create these yet)
const s0=db.getState(); s0.tournaments.push({id:"bd-t",sport:"badminton",name:"BD",season:2026,ageCutoff:"2026-10-01",regOpen:true}); s0.stages.push({id:"bd-st",categoryId:"bd-cat",seq:1,name:"Knockout",kind:"knockout",groups:1,legs:1,advance:0});
s0.categories.push({id:"bd-cat",tournamentId:"bd-t",sport:"badminton",name:"BD Open",gender:"X",format:"singles",minAge:0,maxAge:120,fee:100});
s0.accounts.push({id:"bd-org",name:"BD Organiser",username:"bd_org",passwordHash:await (async()=>{const x=await import("node:crypto");return null})(),role:"organiser",sport:"badminton",perms:ALL});
const ttCat=db.getState().categories.find(c=>c.sport==="table-tennis"&&c.name==="18–45"&&c.gender==="M").id;
// ---- two players with entries
for (const [n,m] of [["Rahul","9876500001"],["Amit","9876500002"]]) {
  t("player "+n+" registers", await db.signUp({name:n,mobile:m,pin:"4321"}), true);
  t("player "+n+" adds profile", await db.savePlayer({name:n,dob:"1996-05-10",gender:"M",society:"Kumar Park",relation:"self"}), true);
  const pid=db.getState().players.find(p=>p.name===n).id;
  t("player "+n+" enters", await db.register({playerId:pid,categoryId:ttCat}), true);
  await db.signOut();
}
const entry1=db.getState().registrations[0].id; const pl1=db.getState().players[0].id; const acc1=db.getState().accounts.find(a=>a.mobile==="9876500001").id;
// ---- TT organiser: can run the tournament
t("organiser signs in", await db.staffSignIn({username:"TT_Org",password:"OrgPass123"}), true);
t("organiser adds a category", await db.saveCategory({tournamentId:TID,name:"Test",gender:"M",format:"singles",minAge:1,maxAge:5,fee:50}), true);
const testCat=db.getState().categories.find(c=>c.name==="Test").id;
t("organiser edits fee", await db.saveCategory({tournamentId:TID,id:ttCat,name:"18–45",gender:"M",format:"singles",minAge:18,maxAge:45,fee:200}), true);
t("organiser deletes an empty category", await db.deleteCategory(testCat), true);
t("organiser marks an entry paid", await db.setPaid(entry1,true), true);
t("organiser makes a draw", await db.generateStage(STG(ttCat)), true);
const m=db.getState().matches.find(x=>x.categoryId===ttCat);
t("organiser enters a score", await db.saveScore(m.id,{score1:2,score2:1}), true);
t("organiser clears the draw", await db.clearStage(STG(ttCat)), true);
t("organiser withdraws an entry", await db.withdraw(entry1), true);
// ---- TT organiser: cannot touch players or admin things
t("organiser CANNOT edit a player profile", await db.adminSavePlayer(pl1,{name:"Hacked",dob:"1990-01-01",gender:"M",society:""}), false);
t("organiser CANNOT remove a player", await db.adminRemovePlayer(pl1), false);
t("organiser CANNOT reset a PIN", await db.resetPin(acc1,"1111"), false);
t("organiser with setup permission CAN edit own tournament settings", await db.saveTournament({id:TID,sport:"table-tennis",name:"X",season:2030,ageCutoff:"2030-10-01"}), true);
t("organiser CANNOT wipe data", await db.resetAllData(), false);
t("organiser CANNOT create organisers", await db.saveOrganiser({name:"Z",username:"zzz_org",password:"OrgPass123",sport:"table-tennis",perms:ALL}), false);
t("organiser CANNOT delete organisers", await db.deleteOrganiser(db.getState().accounts.find(a=>a.username==="tt_org").id), false);
t("organiser CANNOT save a player as themselves", await db.savePlayer({name:"Me",dob:"1990-01-01",gender:"M",society:"",relation:"self"}), false);
t("organiser CANNOT register players", await db.register({playerId:pl1,categoryId:ttCat}), false);
t("player name unchanged", {ok: db.getState().players.find(p=>p.id===pl1).name==="Rahul"}, true);
// ---- TT organiser vs another sport's tournament
t("TT organiser CANNOT delete a badminton category", await db.deleteCategory("bd-cat"), false);
t("TT organiser CANNOT draw a badminton category", await db.generateStage(STG("bd-cat")), false);
t("TT organiser CANNOT clear a badminton draw", await db.clearStage(STG("bd-cat")), false);
await db.signOut();
// ---- badminton organiser vs table tennis
Object.assign(db.getState().accounts.find(a=>a.id==="bd-org"),{passwordHash:null});
// sign in path needs a real hash; instead emulate session for the badminton organiser
db.getState().session="bd-org";
t("BD organiser CANNOT edit a TT category", await db.saveCategory({tournamentId:TID,id:ttCat,name:"X",gender:"M",format:"singles",minAge:1,maxAge:2,fee:1}), false);
t("BD organiser CANNOT add TT categories", await db.saveCategory({tournamentId:TID,name:"New",gender:"M",format:"singles",minAge:1,maxAge:2,fee:1}), false);
t("BD organiser CANNOT mark TT payments", await db.setPaid(db.getState().registrations[0].id,true), false);
t("BD organiser CANNOT draw TT", await db.generateStage(STG(ttCat)), false);
t("BD organiser CAN manage its own category", await db.deleteCategory("bd-cat"), true);
db.getState().session=null;
// ---- admin can do everything
t("admin signs in again", await db.staffSignIn({username:"admin",password:"admin123"}), true);
t("admin edits a player profile", await db.adminSavePlayer(pl1,{name:"Rahul Patil",dob:"1996-05-10",gender:"M",society:"Kumar Park"}), true);
t("admin resets a PIN", await db.resetPin(acc1,"1111"), true);
t("admin removes a player (blocked if entries)", await db.adminRemovePlayer(db.getState().players.find(p=>p.name==="Amit").id), false);
t("admin changes season settings", await db.saveTournament({id:TID,sport:"table-tennis",name:"Warje",season:2026,ageCutoff:"2026-10-01"}), true);
{const r=await db.generateStage(STG(ttCat)); t("admin passes the permission check on any tournament", {ok: r.ok || /entries are needed/.test(r.error)}, true);}
t("admin deletes organiser", await db.deleteOrganiser(db.getState().accounts.find(a=>a.username==="tt_org").id), true);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
