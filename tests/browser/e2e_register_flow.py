import json
from playwright.sync_api import sync_playwright
seed=json.load(open("/tmp/seed.json")); ok=bad=0
def chk(n,c):
    global ok,bad
    print(("PASS " if c else "FAIL ")+n); ok+=bool(c); bad+=(not c)
B="http://localhost:4181"
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":390,"height":844})
    ctx.add_init_script("(()=>{const s="+json.dumps(seed)+"; if(!localStorage.getItem('warje.db.v1')) for (const k in s) localStorage.setItem(k,s[k]);})()")
    pg=ctx.new_page(); errs=[]
    pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None); pg.on("pageerror",lambda e: errs.append(str(e)))
    pg.goto(B+"/login"); pg.get_by_label("Mobile number").fill("9876500000"); pg.locator('input[type=password]').fill("4321")
    pg.get_by_role("button",name="Sign in",exact=True).click(); pg.wait_for_timeout(500)
    pg.goto(B+"/sport/table-tennis/register"); pg.wait_for_timeout(400)
    chk("three numbered steps", pg.get_by_text("Choose the tournament").count()==1 and pg.get_by_text("Who is playing?").count()==1 and pg.get_by_text("Choose the categories").count()==1)
    chk("tournament is shown as a card and preselected", pg.locator("button[aria-pressed=true]",has_text="Warje Olympics 2026").count()==1)
    chk("only player is preselected", pg.locator("button[aria-pressed=true]",has_text="Player 0").count()==1)
    chk("categories shown without extra taps", pg.get_by_text("Open · Men singles").count()>0)
    chk("category help text names tournament and age", pg.get_by_text("that fit Player 0").count()==1)
    pg.screenshot(path="/tmp/r_flow.png",full_page=True)
    chk("already-entered category is marked Entered", pg.get_by_text("Entered",exact=True).count()==1)
    chk("submit button asks to choose a category", pg.get_by_role("button",name="Choose at least one category").count()==1)
    chk("no console errors", len(errs)==0)
    b.close()
print(f"\n{ok} passed, {bad} failed")
