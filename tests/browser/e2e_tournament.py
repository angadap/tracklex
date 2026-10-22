import json
from playwright.sync_api import sync_playwright
S="/tmp"
seed=json.load(open(S+"/seed.json"))
ok=bad=0
def chk(n,c):
    global ok,bad
    print(("PASS " if c else "FAIL ")+n); ok+=bool(c); bad+=(not c)
B="http://localhost:4173"
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":390,"height":844})
    ctx.add_init_script("(()=>{const s="+json.dumps(seed)+"; if(!localStorage.getItem('warje.db.v1')) for (const k in s) localStorage.setItem(k,s[k]);})()")
    pg=ctx.new_page()
    errs=[]; pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None); pg.on("pageerror",lambda e: errs.append(str(e)))
    def staff(u,pw):
        pg.goto(B+"/login"); pg.get_by_role("tab",name="Admin / Organiser").click()
        pg.locator('input').nth(0).fill(u); pg.locator('input[type=password]').fill(pw)
        pg.get_by_role("button",name="Sign in",exact=True).click(); pg.wait_for_timeout(500)
    staff("admin","admin123")
    chk("dashboard has Tournaments tile", pg.get_by_text("Tournaments",exact=True).count()>0)
    pg.get_by_text("Tournaments",exact=True).click(); pg.wait_for_timeout(300)
    chk("tournament listed", pg.get_by_text("Warje Olympics 2026").count()>0)
    pg.screenshot(path=S+"/n_tournaments.png")
    pg.get_by_role("button",name="New tournament").click(); sh=pg.get_by_role("dialog")
    sh.get_by_label("Tournament name").fill("Monsoon Cup"); sh.get_by_role("button",name="Save tournament").click(); pg.wait_for_timeout(400)
    chk("second tournament created", pg.get_by_text("Monsoon Cup").count()>0)
    pg.get_by_text("Warje Olympics 2026").first.click(); pg.wait_for_timeout(300)
    chk("tournament page lists the category", pg.get_by_text("Open · Men singles").count()>0)
    pg.screenshot(path=S+"/n_tournament.png")
    pg.get_by_text("Open · Men singles").click(); pg.wait_for_timeout(300)
    chk("category page shows Rounds with a Knockout stage", pg.get_by_text("Rounds",exact=True).count()>0 and pg.get_by_text("Knockout").count()>0)
    # edit stage 1 -> round robin, 2 groups, 2 advance
    pg.get_by_role("button",name="Edit Knockout").click(); sh=pg.get_by_role("dialog")
    sh.get_by_label("Name",exact=True).fill("Group stage"); sh.get_by_text("Round robin",exact=True).click()
    nums=sh.locator("input[inputmode=numeric]"); nums.nth(0).fill("2"); nums.nth(1).fill("2")
    pg.screenshot(path=S+"/n_stage_sheet.png")
    sh.get_by_role("button",name="Save stage").click(); pg.wait_for_timeout(300)
    chk("stage summary updated", pg.get_by_text("Round robin · 2 groups · top 2 advance").count()>0)
    # add knockout stage
    pg.get_by_role("button",name="Add stage").click(); sh=pg.get_by_role("dialog")
    sh.get_by_label("Name",exact=True).fill("Knockout"); sh.get_by_role("button",name="Save stage").click(); pg.wait_for_timeout(300)
    chk("two stages", pg.get_by_text("Group stage").count()>0 and pg.get_by_text("Knockout",exact=True).count()>0)
    pg.get_by_role("button",name="Make matches").first.click(); pg.wait_for_timeout(400)
    chk("group tables and matches appear", pg.get_by_text("Group A").count()>0 and pg.get_by_text("Group B").count()>0)
    chk("12 matches to play", pg.get_by_text("0 of 12 played").count()>0)
    pg.screenshot(path=S+"/n_groups.png",full_page=True)
    # score every group match through the UI
    for i in range(12):
        pg.get_by_text("To be played").first.click(); sh=pg.get_by_role("dialog")
        ins=sh.locator("input[inputmode=numeric]")
        # result inputs are the last two numeric inputs
        n=ins.count(); ins.nth(n-2).fill("2"); ins.nth(n-1).fill("1")
        sh.get_by_role("button",name="Save result").click(); pg.wait_for_timeout(150)
    chk("12 of 12 played", pg.get_by_text("12 of 12 played").count()>0)
    # knockout stage: make matches
    pg.get_by_role("button",name="Make matches").first.click(); pg.wait_for_timeout(400)
    chk("semi-finals made from qualifiers", pg.get_by_text("Semi-finals").count()>0)
    # schedule a match by hand slot: add match slot on knockout
    pg.get_by_role("button",name="Add match slot").nth(1).click(); sh=pg.get_by_role("dialog")
    sh.get_by_label("Round name").fill("Bronze"); sh.get_by_label("Date and time").fill("2026-11-20T10:30")
    sh.get_by_role("button",name="Add match slot").click(); pg.wait_for_timeout(300)
    chk("extra slot added with its time", pg.get_by_text("Bronze").count()>0 and pg.get_by_text("20 Nov").count()>0)
    pg.screenshot(path=S+"/n_knockout.png",full_page=True)
    # public view
    pg.goto(B+"/sport/table-tennis"); pg.wait_for_timeout(300)
    pg.locator("select[aria-label=Tournament]").select_option(label="Warje Olympics 2026"); pg.wait_for_timeout(200)
    chk("public page shows stage names and tables", pg.get_by_text("Group stage").count()>0 and pg.get_by_text("Group A").count()>0)
    chk("public page has tournament picker", pg.locator("select[aria-label=Tournament]").count()==1)
    pg.screenshot(path=S+"/n_public.png",full_page=True)
    # clear stage 1 warns and clears later stages
    pg.goto(B+"/admin/tournaments"); pg.get_by_text("Warje Olympics 2026").first.click(); pg.get_by_text("Open · Men singles").click(); pg.wait_for_timeout(300)
    pg.once("dialog",lambda d: d.accept())
    pg.get_by_role("button",name="Clear matches of Group stage").click(); pg.wait_for_timeout(300)
    chk("clear removes all matches", pg.get_by_text("No matches yet").count()==2)
    chk("no console errors", len(errs)==0)
    if errs: print(errs[:5])
    b.close()
print(f"\n{ok} passed, {bad} failed")
