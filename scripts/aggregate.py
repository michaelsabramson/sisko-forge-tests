import glob,json,math,re,os
req=json.load(open('tests/request.json')); arms=req['arms']
res=[[0,0] for _ in arms]
for f in glob.glob('out/**/arm*_*.log',recursive=True):
    i=int(re.match(r'arm(\d+)_',os.path.basename(f)).group(1)); me=arms[i]['deck']
    for l in open(f,errors='ignore'):
        m=re.match(r'G\d+ winner=(\S+)',l)
        if m: res[i][1]+=1; res[i][0]+= m.group(1)==me
def p(i): w,n=res[i]; return w/max(1,n),n
t=[f"# {req['name']}\n\nSwapped card forced into opening hand (band {req.get('band',0)}). Same opponents/seats per game index in every arm.\n",
   "| List | Card | Games | Wins | Win rate |","|---|---|---|---|---|"]
for i,a in enumerate(arms): pi,n=p(i); t.append(f"| {a['deck']} | {a['card']} | {n} | {res[i][0]} | {100*pi:.1f}% |")
p0,n0=p(0); t.append(f"\nGaps vs {arms[0]['card']} (95% interval):\n")
for i,a in enumerate(arms[1:],1):
    pi,n=p(i); se=math.sqrt(p0*(1-p0)/max(1,n0)+pi*(1-pi)/max(1,n))
    t.append(f"- **{a['card']}: {100*(pi-p0):+.1f} ± {196*se:.1f} points**")
txt="\n".join(t)+"\n"
os.makedirs('results',exist_ok=True); open(f"results/{req['name']}.md",'w').write(txt); print(txt)
