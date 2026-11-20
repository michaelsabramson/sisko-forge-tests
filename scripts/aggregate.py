import glob,json,math,re,sys,os
req=json.load(open('tests/request.json')); A,B=req['deckA'],req['deckB']
res={A:[0,0],B:[0,0]}
for f in glob.glob('out/**/*.log',recursive=True):
    for l in open(f,errors='ignore'):
        m=re.match(r'G\d+ winner=(\S+)',l)
        if not m: continue
        pod=os.path.basename(f).split('_')[0]  # deck name prefix
        me=A if pod=='A' else B
        res[me][1]+=1; res[me][0]+= m.group(1)==me
(a,na),(b,nb)=res[A],res[B]
pa=a/max(1,na); pb=b/max(1,nb); se=math.sqrt(pa*(1-pa)/max(1,na)+pb*(1-pb)/max(1,nb))
txt=(f"# {req['name']}\n\nSwapped card forced into opening hand (band {req.get('band',0)}). Separate pods, same opponents/seats per game index.\n\n"
     f"| List | Card | Games | Wins | Win rate |\n|---|---|---|---|---|\n"
     f"| {A} | {req['cardA']} | {na} | {a} | {100*pa:.1f}% |\n| {B} | {req['cardB']} | {nb} | {b} | {100*pb:.1f}% |\n\n"
     f"**Gap ({B} − {A}): {100*(pb-pa):+.1f} ± {196*se:.1f} points** (95% interval)\n")
os.makedirs('results',exist_ok=True); open(f"results/{req['name']}.md",'w').write(txt); print(txt)
