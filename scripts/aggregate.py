import glob,json,math,re,os
req=json.load(open('tests/request.json')); arms=req['arms']
res=[[0,0] for _ in arms]
for f in glob.glob('out/**/arm*_*.log',recursive=True):
    i=int(re.match(r'arm(\d+)_',os.path.basename(f)).group(1)); me=arms[i]['deck']
    for l in open(f,errors='ignore'):
        m=re.match(r'G\d+ winner=(\S+)',l)
        if m: res[i][1]+=1; res[i][0]+= m.group(1)==me
def p(i): w,n=res[i]; return w/max(1,n),n
intro = ("Whole lists compared, nothing forced into the opening hand." if req.get('mode')=='decks'
         else f"Swapped card forced into opening hand (band {req.get('band',0)}).")
t=[f"# {req['name']}\n\n{intro} Same opponents/seats per game index in every arm.\n",
   "| List | Card | Games | Wins | Win rate |","|---|---|---|---|---|"]
for i,a in enumerate(arms): pi,n=p(i); t.append(f"| {a['deck']} | {a['card']} | {n} | {res[i][0]} | {100*pi:.1f}% |")
pairs=req.get('compare') or [[0,i] for i in range(1,len(arms))]
t.append("\nGaps (95% interval):\n")
for b,i in pairs:
    p0,n0=p(b); pi,n=p(i); se=math.sqrt(p0*(1-p0)/max(1,n0)+pi*(1-pi)/max(1,n))
    lab=lambda a: a['card'] or a['deck']
    t.append(f"- **{lab(arms[i])} vs {lab(arms[b])}: {100*(pi-p0):+.1f} ± {196*se:.1f} points**")
data={"name":req['name'],"mode":req.get('mode','swap'),"run_id":os.environ.get('GITHUB_RUN_ID'),
      "finished":__import__('time').strftime('%Y-%m-%dT%H:%M:%SZ',__import__('time').gmtime()),
      "arms":[dict(a,games=res[i][1],wins=res[i][0]) for i,a in enumerate(arms)],"compare":pairs,
      "opponents":req.get('opponents')}
t.append("\n<!-- data "+json.dumps(data)+" -->")
txt="\n".join(t)+"\n"
os.makedirs('results',exist_ok=True); open(f"results/{req['name']}.md",'w').write(txt); print(txt)
