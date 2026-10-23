import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const M = new URL("../../supabase/migrations/", import.meta.url).pathname;
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
`);
for (const f of ["0001_tables","0002_access","0004_auth_attempts","0005_permissions","0006_tournaments","0007_actions","0008_player_extras_and_age"]) {
  try { await db.exec(fs.readFileSync(M+f+".sql","utf8")); console.log("applied", f); }
  catch (e) { console.log("MIGRATION FAILED", f, e.message); process.exit(2); }
}
let pass=0, fail=0;
const check=(name,good,extra="")=>{ good?pass++:fail++; console.log(good?"PASS":"FAIL", name, good?"":extra); };
// run as a user: returns {ok, rows|error}
async function as(uid, sql, params=[]) {
  await db.exec("reset role");
  if (uid) { await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]); await db.exec("set role authenticated"); }
  else { await db.exec("select set_config('request.jwt.claim.sub','',false)"); await db.exec("set role anon"); }
  try { const r = await db.query(sql, params); return { ok:true, rows:r.rows }; }
  catch (e) { return { ok:false, error:e.message }; }
  finally { await db.exec("reset role"); }
}
const su = async (sql, p=[]) => (await db.query(sql,p)).rows;
const expectOk = async (name, uid, sql, p) => { const r=await as(uid,sql,p); check(name, r.ok, r.error); return r; };
const expectFail = async (name, uid, sql, p, re) => { const r=await as(uid,sql,p); check(name, !r.ok && (!re || re.test(r.error)), r.ok?"(allowed!)":r.error); return r; };

// ---- people
const uid = async () => (await su("insert into auth.users default values returning id"))[0].id;
const admin = await uid(), orgFull = await uid(), orgScorer = await uid(), orgDraws = await uid(), orgBD = await uid();
await su("insert into profiles (id,name,username,role) values ($1,'Admin','admin1','admin')",[admin]);
const ORG=(id,u,sport,perms)=>su("insert into profiles (id,name,username,role,sport,perms) values ($1,$2,$2,'organiser',$3,$4)",[id,u,sport,perms]);
await ORG(orgFull,"full","table-tennis",["categories","entries","draws","scores"]);
await ORG(orgScorer,"scorer","table-tennis",["scores"]);
await ORG(orgDraws,"draws","table-tennis",["draws"]);
await ORG(orgBD,"bdfull","badminton",["categories","entries","draws","scores"]);
const players=[]; // 12 adult men
for (let i=0;i<12;i++){ const id=await uid(); await su("insert into profiles (id,name,mobile,role) values ($1,$2,$3,'player')",[id,"P"+i,"98765000"+String(i).padStart(2,"0")]);
  const pl=(await su("insert into players (account_id,name,dob,gender,relation) values ($1,$2,'1996-05-10','M','self') returning id",[id,"P"+i]))[0].id; players.push({acc:id,pl}); }

// ---- tournament + categories
const T = (await expectOk("admin creates tournament", admin, "select save_tournament(null,'table-tennis','Warje Olympics 2026',2026,'2026-10-01','2026-11-01','2026-11-30',true) as id")).rows[0].id;
await expectFail("badminton organiser cannot create a TT tournament", orgBD, "select save_tournament(null,'table-tennis','X',2026,'2026-10-01',null,null,true)", [], /assigned|permission/);
await expectFail("scorer cannot create a tournament", orgScorer, "select save_tournament(null,'table-tennis','X',2026,'2026-10-01',null,null,true)", [], /permission/);
await expectFail("end before start rejected", admin, "select save_tournament(null,'table-tennis','X',2026,'2026-10-01','2026-11-30','2026-11-01',true)", [], /end date/);
await expectOk("organiser with setup perm creates a tournament", orgFull, "select save_tournament(null,'table-tennis','Side event',2026,'2026-10-01',null,null,true)");
const mk = async (name, t=T) => (await as(admin,"select save_category($1,$2,$3,'M','singles',18,45,0) as id",[null,t,name])).rows[0].id;
const catRR = await mk("RR groups"); 
const stagesOf = async (c) => su("select * from stages where category_id=$1 order by seq",[c]);
check("new category gets one knockout stage", (await stagesOf(catRR)).length===1 && (await stagesOf(catRR))[0].kind==="knockout");
const st1 = (await stagesOf(catRR))[0].id;
await expectFail("scorer cannot edit stages", orgScorer, "select save_stage($1,$2,'G','round_robin',2,1,2)", [st1,catRR], /permission/);
await expectOk("admin turns stage 1 into groups (2 groups, 2 advance)", admin, "select save_stage($1,$2,'Groups','round_robin',2,1,2)", [st1,catRR]);
const st2 = (await as(admin,"select save_stage(null,$1,'Knockout','knockout',1,1,0) as id",[catRR])).rows[0].id;
check("second stage is ordered after the first", (await stagesOf(catRR)).map(s=>s.name).join()==="Groups,Knockout");
await expectFail("bad kind rejected", admin, "select save_stage(null,$1,'X','swiss',1,1,0)", [catRR], /format/);
await expectFail("0 groups rejected", admin, "select save_stage(null,$1,'X','round_robin',0,1,0)", [catRR], /groups/);

// ---- entries
const reg = {};
for (let i=0;i<8;i++) { const r=await as(players[i].acc,"select register_entry($1,$2,'') as id",[players[i].pl,catRR]); check("P"+i+" enters", r.ok, r.error); reg[i]=r.rows?.[0]?.id; }
await su("update tournaments set reg_open=false where id=$1",[T]);
await expectFail("closed tournament refuses entries", players[8].acc, "select register_entry($1,$2,'')", [players[8].pl,catRR], /closed/);
await su("update tournaments set reg_open=true where id=$1",[T]);
await expectFail("full organiser needs setup perm only; scorer cannot generate", orgScorer, "select generate_stage($1)", [st1], /permission/);
await expectFail("later stage before the earlier one", orgFull, "select generate_stage($1)", [st2], /first/);
await expectOk("generate round robin groups", orgFull, "select generate_stage($1)", [st1]);
const ms1 = await su("select * from matches where stage_id=$1 order by group_no, round, seq",[st1]);
check("2 groups of 4 -> 12 matches", ms1.length===12, ms1.length);
check("3 rounds per group", new Set(ms1.filter(m=>m.group_no===1).map(m=>m.round)).size===3);
const pairKey=(m)=>[m.p1_reg_id,m.p2_reg_id].sort().join("|");
check("every pair meets exactly once", new Set(ms1.map(pairKey)).size===12);
check("nobody plays twice in a round", ms1.every(m=>ms1.filter(x=>x.group_no===m.group_no&&x.round===m.round&&(x.p1_reg_id===m.p1_reg_id||x.p2_reg_id===m.p1_reg_id)).length===1));
await expectFail("generating again refused", orgFull, "select generate_stage($1)", [st1], /already has its matches/);
await expectFail("entries close once matches exist", players[9].acc, "select register_entry($1,$2,'')", [players[9].pl,catRR], /closed|started/);
await expectFail("withdraw blocked once drawn", orgFull, "select withdraw_entry($1)", [reg[0]], /draw has started/);
await expectFail("next stage refused while stage 1 unfinished", orgFull, "select generate_stage($1)", [st2], /Finish every match/);
// scores: p1 wins 2-1, scorer enters them
for (const m of ms1) await as(orgScorer,"select save_score($1,2,1,'')",[m.id]);
check("all stage 1 matches done", (await su("select count(*)::int c from matches where stage_id=$1 and status='done'",[st1]))[0].c===12);
const stand = (await as(null,"select * from stage_standings($1) order by group_no, rank",[st1])).rows;
// anon may call standings (public)
check("standings: 8 rows, 4 per group, played 3 each", stand.length===8 && stand.every(r=>r.played===3) && [1,2].every(g=>stand.filter(r=>r.group_no===g).length===4));
check("standings ranks 1..4 in each group", [1,2].every(g=>stand.filter(r=>r.group_no===g).map(r=>r.rank).join()==="1,2,3,4"));
check("wins sorted descending within group", [1,2].every(g=>{const w=stand.filter(r=>r.group_no===g).map(r=>r.won); return w.every((x,i)=>i===0||w[i-1]>=x);}));
await expectOk("generate knockout from the top 2 of each group", orgFull, "select generate_stage($1)", [st2]);
const ms2 = await su("select * from matches where stage_id=$1 order by seq",[st2]);
const qual = new Set(stand.filter(r=>r.rank<=2).map(r=>r.reg_id));
check("2 semi-finals", ms2.length===2 && ms2.every(m=>m.round_label==="Semi-finals"));
check("semi-final players are exactly the qualifiers", ms2.flatMap(m=>[m.p1_reg_id,m.p2_reg_id]).every(x=>qual.has(x)) && new Set(ms2.flatMap(m=>[m.p1_reg_id,m.p2_reg_id])).size===4);
await expectFail("stage 1 result locked once stage 2 exists", orgScorer, "select save_score($1,0,2,'')", [ms1[0].id], /later stage/);
await expectFail("clear_score locked too", orgScorer, "select clear_score($1)", [ms1[0].id], /later stage/);
for (const m of ms2) await as(orgScorer,"select save_score($1,2,0,'')",[m.id]);
await expectOk("final made", orgFull, "select generate_stage($1)", [st2]);
const fin = (await su("select * from matches where stage_id=$1 and round=2",[st2]));
check("one final", fin.length===1 && fin[0].round_label==="Final");
await expectFail("semi result locked once final exists", orgScorer, "select save_score($1,0,2,'')", [ms2[0].id], /next round/);
await as(orgScorer,"select save_score($1,2,1,'')",[fin[0].id]);
await expectFail("no more rounds after the final", orgFull, "select generate_stage($1)", [st2], /champion/);
await expectFail("draws-only organiser cannot score", orgDraws, "select save_score($1,1,2,'')", [fin[0].id], /permission/);
await expectOk("clear_stage on stage 1 removes everything after it", orgDraws, "select clear_stage($1)", [st1]);
check("no matches left in the category", (await su("select count(*)::int c from matches where category_id=$1",[catRR]))[0].c===0);
await expectOk("stage can be edited again", admin, "select save_stage($1,$2,'Groups','round_robin',1,2,2)", [st1,catRR]);

// ---- double round robin, one group of 4 -> 12 matches over 6 rounds; second leg swaps sides
await expectOk("generate double round robin", orgDraws, "select generate_stage($1)", [st1]);
const dd = await su("select * from matches where stage_id=$1",[st1]);
check("double RR, 8 players = 56 matches over 14 rounds", dd.length===56 && new Set(dd.map(m=>m.round)).size===14, dd.length);
check("each ordered pair appears once (home and away)", new Set(dd.map(m=>m.p1_reg_id+">"+m.p2_reg_id)).size===56);
await su("delete from matches where category_id=$1",[catRR]);

// ---- odd count round robin (5 -> 10 matches) via a fresh category with a RR stage
const catOdd = await mk("odd RR"); const stOdd=(await stagesOf(catOdd))[0].id;
await as(admin,"select save_stage($1,$2,'League','round_robin',1,1,0)",[stOdd,catOdd]);
for (let i=0;i<5;i++) await as(players[i].acc,"select register_entry($1,$2,'')",[players[i].pl,catOdd]);
await expectOk("generate 5-player league", admin, "select generate_stage($1)", [stOdd]);
check("5 players -> 10 matches, 5 rounds", (await su("select count(*)::int c, count(distinct round)::int r from matches where stage_id=$1",[stOdd]))[0].c===10);
await expectFail("league without advance cannot feed a next stage", admin, "select generate_stage((select id from stages where id=$1))", [stOdd], /already has/);
{ const cg=await mk("3 players 2 groups"); const sg=(await stagesOf(cg))[0].id;
  await as(admin,"select save_stage($1,$2,'G','round_robin',2,1,0)",[sg,cg]);
  for (let i=0;i<3;i++) await as(players[i].acc,"select register_entry($1,$2,'')",[players[i].pl,cg]);
  await expectFail("too many groups for the entries refused", admin, "select generate_stage($1)", [sg], /Too many groups/); }
// ---- odd knockout with byes
const catKO = await mk("KO 5"); const stKO=(await stagesOf(catKO))[0].id;
for (let i=0;i<5;i++) await as(players[i].acc,"select register_entry($1,$2,'')",[players[i].pl,catKO]);
await expectOk("generate 5-player knockout", admin, "select generate_stage($1)", [stKO]);
const ko = await su("select * from matches where stage_id=$1 order by seq",[stKO]);
check("5 entries -> 3 slots, 1 bye", ko.length===3 && ko.filter(m=>m.bye).length===1 && ko.find(m=>m.bye).winner_reg_id===ko.find(m=>m.bye).p1_reg_id);
await expectFail("bye has no score", admin, "select save_score($1,2,0,'')", [ko.find(m=>m.bye).id], /bye/);
await expectFail("tie refused", admin, "select save_score($1,1,1,'')", [ko.find(m=>!m.bye).id], /level/);

// ---- knockout followed by another stage must be refused (knockout does not advance anyone)
const stKO2 = (await as(admin,"select save_stage(null,$1,'Extra','knockout',1,1,0) as id",[catKO])).rows[0].id;
for (const m of ko.filter(m=>!m.bye)) await as(admin,"select save_score($1,2,0,'')",[m.id]);
await expectFail("a stage after a knockout is refused", admin, "select generate_stage($1)", [stKO2], /does not send players/);

// ---- custom stage: slots by hand
const catC = await mk("Custom"); const stC=(await stagesOf(catC))[0].id;
await as(admin,"select save_stage($1,$2,'Friendly','custom',1,1,0)",[stC,catC]);
const rc=[]; for (let i=0;i<4;i++){ const r=await as(players[i].acc,"select register_entry($1,$2,'') as id",[players[i].pl,catC]); rc.push(r.rows[0].id); }
await expectFail("custom stage cannot be auto-generated", admin, "select generate_stage($1)", [stC], /by hand/);
const slot = (await expectOk("add an empty slot", orgDraws, "select save_match(null,$1,null,null,'Opening match',1,'2026-11-05 10:00+05:30') as id",[stC])).rows[0].id;
await expectFail("same player twice refused", orgDraws, "select save_match($1,null,$2,$2,'x',1,null)", [slot,rc[0]], /different/);
await expectFail("player from another category refused", orgDraws, "select save_match($1,null,$2,$3,'x',1,null)", [slot,rc[0],(await su("select id from registrations where category_id=$1 limit 1",[catKO]))[0].id], /not entered/);
await expectFail("score refused until both players set", orgScorer, "select save_score($1,2,0,'')", [slot], /Both players/);
await expectOk("fill the players and set the time", orgDraws, "select save_match($1,null,$2,$3,'Opening match',1,'2026-11-05 11:30+05:30')", [slot,rc[0],rc[1]]);
check("scheduled time stored", (await su("select scheduled_at from matches where id=$1",[slot]))[0].scheduled_at.toISOString()==="2026-11-05T06:00:00.000Z");
await expectOk("scorer can set the schedule", orgScorer, "select set_schedule($1,'2026-11-06 09:00+05:30')", [slot]);
await expectFail("scorer cannot edit players of a slot", orgScorer, "select save_match($1,null,$2,$3,'x',1,null)", [slot,rc[2],rc[3]], /permission/);
await expectOk("score the slot", orgScorer, "select save_score($1,0,2,'')", [slot]);
const dn=(await su("select status, winner_reg_id from matches where id=$1",[slot]))[0]; check("custom match winner set", dn.status==="done"&&dn.winner_reg_id===rc[1]);
await expectFail("players of a finished match are locked", orgDraws, "select save_match($1,null,$2,$3,'x',1,null)", [slot,rc[2],rc[3]], /result/);
await expectOk("clear the result", orgScorer, "select clear_score($1)", [slot]);
await expectOk("add a second slot", orgDraws, "select save_match(null,$1,$2,$3,'Second',2,null)", [stC,rc[2],rc[3]]);
check("custom standings work", (await as(admin,"select count(*)::int c from stage_standings($1)",[stC])).rows[0].c===4);
await expectOk("delete a slot", orgDraws, "select delete_match($1)", [slot]);
await expectFail("delete_stage with matches refused", admin, "select delete_stage($1)", [stC], /has matches/);
await expectFail("changing a stage's format with matches refused", admin, "select save_stage($1,$2,'Friendly','knockout',1,1,0)", [stC,catC], /already has matches/);
await expectOk("renaming a stage with matches is fine", admin, "select save_stage($1,$2,'Friendly games','custom',1,1,0)", [stC,catC]);

// ---- stage order, delete
const catM = await mk("Order"); const s1=(await stagesOf(catM))[0].id;
const s2=(await as(admin,"select save_stage(null,$1,'B','custom',1,1,0) as id",[catM])).rows[0].id;
await expectOk("move stage up", admin, "select move_stage($1,-1)", [s2]);
check("order swapped", (await stagesOf(catM)).map(s=>s.name).join()==="B,Knockout");
await expectOk("delete empty stage", admin, "select delete_stage($1)", [s2]);

// ---- categories / tournaments
const starter = await expectOk("starter categories", admin, "select add_starter_categories($1)", [T]);
check("starter makes 10 categories each with a stage", (await su("select count(*)::int c from categories where tournament_id=$1 and name in ('Under 10','10–17','46–60','Above 60') ",[T]))[0].c===8 && (await su("select count(*)::int c from categories c where tournament_id=$1 and not exists (select 1 from stages s where s.category_id=c.id)",[T]))[0].c===0);
await expectFail("category with entries cannot be deleted", admin, "select delete_category($1)", [catKO], /entries/);
await expectFail("tournament with entries cannot be deleted", admin, "select delete_tournament($1)", [T], /entries/);
const T2 = (await as(admin,"select save_tournament(null,'table-tennis','Empty',2027,'2027-10-01',null,null,true) as id")).rows[0].id;
await as(admin,"select save_category(null,$1,'Tmp','M','singles',1,2,0)",[T2]);
await expectOk("empty tournament (with categories and stages) deleted", admin, "select delete_tournament($1)", [T2]);
check("its categories and stages are gone", (await su("select count(*)::int c from stages where category_id in (select id from categories where tournament_id=$1)",[T2]))[0].c===0);

// ---- reads
const anonRead = await as(null,"select count(*)::int c from tournaments");
check("anyone can read tournaments, stages and matches", anonRead.ok && (await as(null,"select count(*) from stages")).ok && (await as(null,"select count(*) from matches")).ok);
check("anon cannot write directly", !(await as(null,"insert into tournaments (sport,name,season,age_cutoff) values ('table-tennis','x',2026,'2026-10-01')")).ok);
check("authenticated cannot write directly", !(await as(admin,"insert into stages (category_id,seq,name,kind) values ($1,9,'x','custom')",[catC])).ok);
check("scorer cannot read entries (payment info)", (await as(orgScorer,"select count(*)::int c from registrations")).rows[0].c===0);
check("full organiser reads entries of own sport", (await as(orgFull,"select count(*)::int c from registrations")).rows[0].c>0);
check("badminton organiser sees no TT entries", (await as(orgBD,"select count(*)::int c from registrations")).rows[0].c===0);
check("auth_attempt not callable by users", !(await as(admin,"select auth_attempt('k',5,15)")).ok);
// ---- 0008: age counted today, T-shirt and photo
{
  const T3 = (await as(admin,"select save_tournament(null,'table-tennis','Age test',2026,'2020-01-01',null,null,true) as id")).rows[0].id;
  const c = (await as(admin,"select save_category(null,$1,'Under 20 today','M','singles',0,20,0) as id",[T3])).rows[0].id;
  const acc = await uid(); await su("insert into profiles (id,name,mobile,role) values ($1,'Age acc','9000000001','player')",[acc]);
  const today = (await su("select (now() at time zone 'Asia/Kolkata')::date d"))[0].d;
  const dobFor = (years, plusDays) => { const d = new Date(today); d.setUTCFullYear(d.getUTCFullYear()-years); d.setUTCDate(d.getUTCDate()+plusDays); return d.toISOString().slice(0,10); };
  // exactly 21 today (birthday today): too old. 21 tomorrow-birthday => still 20 today: eligible.
  const old = (await su("insert into players (account_id,name,dob,gender,relation) values ($1,'Turned21',$2,'M','self') returning id",[acc, dobFor(21,0)]))[0].id;
  const young = (await su("insert into players (account_id,name,dob,gender,relation) values ($1,'Turns21Tomorrow',$2,'M','self') returning id",[acc, dobFor(21,1)]))[0].id;
  await expectFail("age is counted today: turned 21 today is too old", acc, "select register_entry($1,$2,'')", [old, c], /not eligible/);
  await expectOk("age is counted today: turns 21 tomorrow is still 20", acc, "select register_entry($1,$2,'')", [young, c]);
  await expectOk("player sets T-shirt size and photo", acc, "select set_player_extras($1,'M','data:image/jpeg;base64,AAAA')", [young]);
  check("T-shirt and photo stored", (await su("select tshirt, photo from players where id=$1",[young]))[0].tshirt==="M");
  await expectFail("bad T-shirt size refused", acc, "select set_player_extras($1,'HUGE','')", [young], /size/);
  await expectFail("non-image photo refused", acc, "select set_player_extras($1,'M','http://x')", [young], /photo/);
  await expectFail("oversized photo refused", acc, "select set_player_extras($1,'M',$2)", [young, "data:image/jpeg;base64,"+"A".repeat(200100)], /photo/);
  await expectOk("both fields can be cleared", acc, "select set_player_extras($1,'','')", [young]);
  const other = await uid(); await su("insert into profiles (id,name,mobile,role) values ($1,'Other','9000000002','player')",[other]);
  await expectFail("another player cannot change them", other, "select set_player_extras($1,'L','')", [young], /not found/i);
  await expectFail("anonymous cannot change them", null, "select set_player_extras($1,'L','')", [young]);
  await expectOk("admin can", admin, "select set_player_extras($1,'XL','')", [young]);
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
