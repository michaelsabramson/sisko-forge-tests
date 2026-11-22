import forge.*; import forge.ai.*; import forge.deck.*; import forge.deck.io.DeckSerializer; import forge.game.*; import forge.game.player.*;
import forge.util.*; import java.io.File; import java.util.*; import java.util.concurrent.*;
public class Run {
  /** Take one game from this runner's pool for the arm. The pool file holds {played, granted}; it starts at -DpoolMax
   *  games. With batches on (-DbatchArm/-DbatchRunner), an empty pool claims another batch of -Dbatch games from the
   *  run (scripts/claimbatch.sh). False once there are no games left to play. */
  static boolean claimGame(String file,int max){
    final String arm=System.getProperty("batchArm"), runner=System.getProperty("batchRunner");
    final String cmd=arm!=null&&runner!=null ? "scripts/claimbatch.sh "+arm+" "+runner : null; final int batch=Integer.getInteger("batch",0);
    try(java.io.RandomAccessFile f=new java.io.RandomAccessFile(file,"rw"); java.nio.channels.FileLock lk=f.getChannel().lock()){
      int used=f.length()>=8?f.readInt():0; int granted=f.length()>=8?f.readInt():max;   // first-round games (or the whole fixed pool)
      if(used>=granted){
        if(cmd==null || batch<=0) return false;
        Process p=new ProcessBuilder("bash","-c",cmd).redirectErrorStream(true).start();
        String outp=new String(p.getInputStream().readAllBytes()).trim(); p.waitFor();
        if(!outp.endsWith("1")) return false;
        granted+=batch;
      }
      f.seek(0); f.writeInt(used+1); f.writeInt(granted); return true;
    }catch(Exception e){ return true; }   // if the pool file fails, fall back to the process's own game count
  }
  static int CardLists_count(Player p){ int n=0; for(var c:p.getCardsIn(forge.game.zone.ZoneType.Battlefield)) if(c.getType().hasCreatureType("Officer")) n++; return n; }
  public static void main(String[] a) throws Exception {
    String res=a[0]; int n=Integer.parseInt(a[1]); long seed=Long.parseLong(a[2]); int timeout=Integer.parseInt(a[3]); boolean log=a[4].equals("log");
    List<String> decks=Arrays.asList(a).subList(5,a.length);
    Lang.createInstance("en-US");
    try { Localizer.getInstance().initialize("en-US", res+"/languages"); } catch(Throwable t){ System.err.println("loc "+t); }
    { var contents = FileSection.parseSections(FileUtil.readFile(res+"/lists/TypeLists.txt"));
      for (String s: contents.keySet()) forge.card.CardType.Helper.parseTypes(s, contents.get(s));
      forge.card.CardType.Constant.LOADED.set();
      for (String s: FileUtil.readFile(res+"/lists/NonStackingKWList.txt")) if (s.length()>1) forge.game.card.CardUtil.NON_STACKING_LIST.add(s); }
    long t0=System.currentTimeMillis();
    new StaticData(new CardStorageReader(res+"/cardsfolder",null,false), new CardStorageReader(res+"/tokenscripts",null,false), null,null,
       res+"/editions", java.nio.file.Files.createTempDirectory("ce").toString(), res+"/blockdata", res+"/setlookup", "Latest Art All Editions", true,false,false,false,null);
    AiProfileUtil.loadAllProfiles(res+"/ai");
    final String LD=res+"/lists/";
    forge.ai.simulation.AiCardLists.configure(() -> FileUtil.readFile(LD+"ai-card-roles.txt"), () -> FileUtil.readFile(LD+"commander-bracket-combos.txt"), () -> FileUtil.readFile(LD+"ai-commander-combos.txt"));
    forge.ai.simulation.ComboCatalog.configure(() -> FileUtil.readFile(LD+"ai-combos.txt"));
    System.err.println("db loaded "+(System.currentTimeMillis()-t0)+"ms");
    MyRandom.setRandom(new Random(seed));
    GameRules rules=new GameRules(GameType.Commander); rules.setAppliedVariants(EnumSet.of(GameType.Commander)); rules.setSimTimeout(timeout);
    List<Deck> ds=new ArrayList<>(); for(String d:decks){ Deck dk=DeckSerializer.fromFile(new File(d)); if(dk==null) throw new RuntimeException("bad deck "+d); ds.add(dk);
      for(var e:dk.getMain()) { } }
    Map<String,Integer> wins=new LinkedHashMap<>(); for(Deck d:ds) wins.put(d.getName(),0); wins.put("Draw",0);
    final Runnable[] dmgHook={null};
    // shared quota: the processes on one runner that play the same arm draw games from one pool (a counter file),
    // so a process that gets slow games doesn't hold the runner up while its neighbours sit idle
    final String poolFile=System.getProperty("pool"); final int poolMax=Integer.getInteger("poolMax",0);
    int g0=Integer.getInteger("start",0); for(int g=g0; g<g0+n; g++){ if(poolFile!=null && !claimGame(poolFile,poolMax)) break; dmgHook[0]=null;
      // rotate seating so the first-player advantage is spread out
      Random gr=new Random(seed*100003L+g); MyRandom.setRandom(new Random(seed*7919L+g));
      int fixedN=Integer.getInteger("fixed",1); List<Deck> pod=new ArrayList<>(ds.subList(0,fixedN)); List<Deck> pool=new ArrayList<>(ds.subList(fixedN,ds.size())); Collections.shuffle(pool,gr); pod.addAll(pool.subList(0,Math.min(4-fixedN,pool.size())));
      List<RegisteredPlayer> pp=new ArrayList<>(); int k=pod.size();
      for(int j=0;j<k;j++){ Deck d=pod.get((j+g)%k); RegisteredPlayer rp=RegisteredPlayer.forCommander(d); LobbyPlayerAi lp=new LobbyPlayerAi(d.getName(),null); lp.setAiProfile(d.getName().startsWith("Sisko") ? System.getProperty("sisko.profile","Default") : "Default"); rp.setPlayer(lp); pp.add(rp);}
      Match mc=new Match(rules,pp,"T"); Game game=mc.createGame(); game.setNoGUIUser();
      // end the game as soon as every tracked (fixed) deck is out: its result is already a loss, so nothing measured changes
      final boolean[] trackedOut={false};
      { final Set<String> mine=new HashSet<>(); for(Deck d:ds.subList(0,fixedN)) mine.add(d.getName());
        game.subscribeToEvents(new Object(){ @com.google.common.eventbus.Subscribe public void endIfOut(forge.game.event.GameEventTurnBegan e){
          if(game.isGameOver()) return; boolean any=false, alive=false;
          for(Player x:game.getRegisteredPlayers()) if(mine.contains(x.getName())){ any=true; if(!x.hasLost()) alive=true; }
          if(any && !alive){ trackedOut[0]=true; game.setGameOver(forge.game.GameEndReason.Draw); } } }); }
      final String auditDeck=System.getProperty("audit"); // deck audit: log the kept opening hand + next 3 draws ("TOP" line, before the G line)
      if(auditDeck!=null){ final boolean[] said={false};
        game.subscribeToEvents(new Object(){ @com.google.common.eventbus.Subscribe public void tbA(forge.game.event.GameEventTurnBegan e){
          if(said[0]) return; said[0]=true;
          for(Player p:game.getRegisteredPlayers()) if(p.getName().equals(auditDeck)){ List<String> top=new ArrayList<>();
            for(var c:p.getCardsIn(forge.game.zone.ZoneType.Hand)) top.add(c.getName());
            int i=0; for(var c:p.getCardsIn(forge.game.zone.ZoneType.Library)){ if(i++>=3) break; top.add(c.getName()); }
            System.out.println("TOP "+String.join("|",top)); } } }); }
      // card-usage log (with -Dusage): for each spell the audited deck held, how long it sat in hand while affordable and whether it was cast
      final Map<String,int[]> use=new LinkedHashMap<>(); final int[] ut={0}; // name -> [firstSeenTurn, affordableTurnsHeld, cast, castTurn, turnsInHand]
      if(auditDeck!=null && System.getProperty("usage")!=null) game.subscribeToEvents(new Object(){
        @com.google.common.eventbus.Subscribe public void uTurn(forge.game.event.GameEventTurnBegan e){
          for(Player p:game.getRegisteredPlayers()) if(p.getName().equals(auditDeck) && e.turnOwner().toString().contains(p.getName())){ ut[0]++;
            int mana=p.getLandsInPlay().size();
            for(var c:p.getCardsIn(forge.game.zone.ZoneType.Hand)){ if(c.isLand()) continue;
              int[] r=use.computeIfAbsent(c.getName(),k->new int[]{ut[0],0,0,0,0}); if(r[2]==0){ r[4]++; if(c.getCMC()<=mana) r[1]++; } } } }
        @com.google.common.eventbus.Subscribe public void uZone(forge.game.event.GameEventCardChangeZone e){
          if(e.from()!=null && e.to()!=null && e.from().zoneType()==forge.game.zone.ZoneType.Hand && e.to().zoneType()==forge.game.zone.ZoneType.Stack
             && e.card().getController()!=null && e.card().getController().getName().equals(auditDeck)){
            int[] r=use.computeIfAbsent(e.card().getName(),k->new int[]{ut[0],0,0,0,0}); if(r[2]==0){ r[2]=1; r[3]=ut[0]; } } } });
      final Map<String,Integer> seen=new LinkedHashMap<>(); final StringBuilder offs=new StringBuilder(); final int[] myTurn={0};
      game.subscribeToEvents(new Object(){ @com.google.common.eventbus.Subscribe public void on(forge.game.event.GameEventTurnBegan e){
        for(Player p:game.getPlayers()) if(p.getName().startsWith("Sisko") && e.turnOwner().toString().contains(p.getName())){ myTurn[0]++;
          offs.append(myTurn[0]).append(":").append(CardLists_count(p)).append(",").append(p.getCardsIn(forge.game.zone.ZoneType.Battlefield).anyMatch(c->c.getName().equals("Captain Benjamin Sisko"))?1:0).append(",").append(p.getLandsInPlay().size()).append(" ");
          for(var c:p.getCardsIn(forge.game.zone.ZoneType.Hand)) seen.putIfAbsent(c.getName(),myTurn[0]);
          for(var c:p.getCardsIn(forge.game.zone.ZoneType.Battlefield)) if(!c.isToken()) seen.putIfAbsent(c.getName(),myTurn[0]);
          for(var c:p.getCardsIn(forge.game.zone.ZoneType.Graveyard)) seen.putIfAbsent(c.getName(),myTurn[0]);
          for(var c:p.getCardsIn(forge.game.zone.ZoneType.Exile)) seen.putIfAbsent(c.getName(),myTurn[0]); } } });
      final StringBuilder dil=new StringBuilder(); final int[] gross={0};
      game.subscribeToEvents(new Object(){
        @com.google.common.eventbus.Subscribe public void ph(forge.game.event.GameEventTurnPhase e){
          if(e.phase()==forge.game.phase.PhaseType.END_OF_TURN) for(Player p:game.getPlayers()) if(p.getName().startsWith("Sisko") && game.getPhaseHandler().isPlayerTurn(p)){
            boolean s=p.getCardsIn(forge.game.zone.ZoneType.Battlefield).anyMatch(c->c.getName().equals("Captain Benjamin Sisko"));
            dil.append(myTurn[0]).append(":").append(p.getDilemmasFacedThisTurn()).append(",").append(s?1:0).append(" "); } }
        @com.google.common.eventbus.Subscribe public void cz(forge.game.event.GameEventCardChangeZone e){
          if(e.to()!=null && e.to().zoneType()==forge.game.zone.ZoneType.Battlefield && e.card().isToken() && e.card().getName().contains("Officer") && e.card().getController()!=null && e.card().getController().getName().startsWith("Sisko")) gross[0]++; } });
      // ---- paired mode: identical starting hands/libraries across the two variants ----
      if(System.getProperty("pair")!=null){
        final String[] swap=System.getProperty("swapkey","").split("\\|");
        final int fband=Integer.getInteger("pairBand",0); final long gseed=seed*1000003L+g;
        final boolean[] pdone={false};
        Player.DEALT.clear();
        game.subscribeToEvents(new Object(){ @com.google.common.eventbus.Subscribe public void tb(forge.game.event.GameEventTurnBegan e){
          if(pdone[0]) return; pdone[0]=true;
          for(Player p:game.getRegisteredPlayers()){
            List<forge.game.card.Card> all=new ArrayList<>(); all.addAll(p.getCardsIn(forge.game.zone.ZoneType.Hand)); all.addAll(p.getCardsIn(forge.game.zone.ZoneType.Library));
            Map<String,Integer> cnt=new HashMap<>(); Map<forge.game.card.Card,Long> key=new HashMap<>();
            for(var c:all){ String nm=c.getName(); for(String s:swap) if(s.equals(nm)) nm="#SWAP#"; int k=cnt.merge(nm,1,Integer::sum);
              long h=new Random(gseed ^ (nm+"#"+k+"#"+p.getName().replaceAll("^Sisko.*","ME")).hashCode()*2654435761L).nextLong();
              if(nm.equals("#SWAP#")) h = (fband==0) ? Long.MIN_VALUE : h; key.put(c,h); }
            all.sort(Comparator.comparingLong(key::get));
            int H=7; List<forge.game.card.Card> hand=new ArrayList<>(all.subList(0,Math.min(H,all.size()))); List<forge.game.card.Card> lib=new ArrayList<>(all.subList(Math.min(H,all.size()),all.size()));
            for(var c:hand) if(!c.isInZone(forge.game.zone.ZoneType.Hand)) game.getAction().moveToHand(c,null);
            for(var c:lib) if(c.isInZone(forge.game.zone.ZoneType.Hand)) game.getAction().moveToLibrary(c,0,null);
            // now order the library exactly: move each to bottom in order
            for(var c:lib) game.getAction().moveToLibrary(c,-1,null);
          }
          MyRandom.setRandom(new Random(gseed*31+7));
          } });
        final int[] tk={0}; final StringBuilder d8=new StringBuilder();
        game.subscribeToEvents(new Object(){ @com.google.common.eventbus.Subscribe public void tb2(forge.game.event.GameEventTurnBegan e){ tk[0]++;
          if(tk[0]==33 && d8.length()==0) d8.append(new HashMap<>(Player.DEALT)); } });
        dmgHook[0]=() -> System.out.println("DMG8 "+(d8.length()==0? new HashMap<>(Player.DEALT).toString() : d8)+" | TOTAL "+new HashMap<>(Player.DEALT));
      }
      // ---- stratified placement of the swapped card (paired across the two test decks) ----
      final String strat=System.getProperty("strat"); // "DeckA=CardA;DeckB=CardB"
      final int[] band={-1}; final int[] pos={0};
      if(strat!=null){
        int[] sched={0,0,0,0,0,1,1,2,2,2,3,3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5};
        band[0]=Integer.getInteger("forceBand",sched[g%sched.length]);
        int[][] rng={{0,6},{1,3},{4,7},{8,12},{13,20},{21,35}};
        pos[0]=rng[band[0]][0]+gr.nextInt(rng[band[0]][1]-rng[band[0]][0]+1);
        final Map<String,String> want=new HashMap<>(); for(String kv:strat.split(";")){ String[] kvp=kv.split("=",2); String[] op=kvp[1].split("\\|"); want.put(kvp[0],op[Math.floorMod(g,op.length)]); } // "A|B|C": packages rotate which card is forced
        final boolean[] done={false};
        game.subscribeToEvents(new Object(){ @com.google.common.eventbus.Subscribe public void tb(forge.game.event.GameEventTurnBegan e){
          if(done[0]) return; done[0]=true;
          for(Player p:game.getRegisteredPlayers()){ String cn=want.get(p.getName()); if(cn==null) continue;
            forge.game.card.Card card=null;
            for(var c:p.getCardsIn(forge.game.zone.ZoneType.Hand)) if(c.getName().equals(cn)) card=c;
            for(var c:p.getCardsIn(forge.game.zone.ZoneType.Library)) if(c.getName().equals(cn)) card=c;
            if(card==null) continue;
            if(band[0]==0){
              if(card.isInZone(forge.game.zone.ZoneType.Hand)) continue;
              forge.game.card.Card out=null; List<forge.game.card.Card> nl=new ArrayList<>(); for(var c:p.getCardsIn(forge.game.zone.ZoneType.Hand)) if(!c.isLand()) nl.add(c);
              if(nl.isEmpty()) for(var c:p.getCardsIn(forge.game.zone.ZoneType.Hand)) nl.add(c);
              out=nl.get(gr.nextInt(nl.size()));
              game.getAction().moveToHand(card,null); game.getAction().moveToLibrary(out, gr.nextInt(Math.max(1,p.getCardsIn(forge.game.zone.ZoneType.Library).size())), null);
            } else {
              if(card.isInZone(forge.game.zone.ZoneType.Hand)){ // replace it in hand with a random library card
                var lib=new ArrayList<>(p.getCardsIn(forge.game.zone.ZoneType.Library)); var rep=lib.get(gr.nextInt(lib.size()));
                game.getAction().moveToHand(rep,null); }
              int lp=Math.min(pos[0]-1, p.getCardsIn(forge.game.zone.ZoneType.Library).size()-1);
              game.getAction().moveToLibrary(card, Math.max(0,lp), null);
            } } } });
      }
      final Map<Integer,Integer> pactUp=new HashMap<>(); final int[] exits={0,0};
      final String pe=System.getProperty("pactExit");
      if(pe!=null) game.subscribeToEvents(new Object(){ @com.google.common.eventbus.Subscribe public void ph(forge.game.event.GameEventTurnPhase e){
        Player me=null; for(Player p:game.getPlayers()) if(p.getName().equals(pe)) me=p; if(me==null) return;
        var ph=game.getPhaseHandler();
        if(e.phase()==forge.game.phase.PhaseType.UPKEEP && ph.isPlayerTurn(me))
          for(var c:me.getCardsIn(forge.game.zone.ZoneType.Battlefield)) if(c.getName().equals("Demonic Pact")||c.getName().equals("Kobayashi Maru Scenario")) pactUp.merge(c.getId(),1,Integer::sum);
        String how=System.getProperty("handoff");
        if(how!=null && e.phase()==forge.game.phase.PhaseType.MAIN1 && ph.isPlayerTurn(me)){
          for(var c:new ArrayList<>(me.getCardsIn(forge.game.zone.ZoneType.Battlefield))) if((c.getName().equals("Demonic Pact")||c.getName().equals("Kobayashi Maru Scenario")) && pactUp.getOrDefault(c.getId(),0)>=3){
            List<forge.game.card.Card> src=new ArrayList<>(); for(var l:me.getCardsIn(forge.game.zone.ZoneType.Battlefield)) if(l.isLand() && l.isUntapped()) src.add(l);
            forge.game.card.Card tool=null; boolean puca=false;
            for(var h:me.getCardsIn(forge.game.zone.ZoneType.Hand)) if(h.getName().equals(how) && !how.equals("Puca's Mischief")) tool=h;
            for(var b:me.getCardsIn(forge.game.zone.ZoneType.Battlefield)) if(b.getName().equals("Puca's Mischief")) { tool=b; puca=true; }
            Player opp=null; for(Player o:me.getOpponents()) if(!o.hasLost() && (opp==null || o.getLife()>opp.getLife())) opp=o;
            if(tool==null || opp==null || (!puca && src.size()<3)) continue;
            if(!puca){ for(int i=0;i<3;i++) src.get(i).tap(true,null,me); game.getAction().moveToGraveyard(tool,null); }
            else { // take their best nonland permanent with MV <= the pact's MV in exchange
              forge.game.card.Card best=null; for(var oc:opp.getCardsIn(forge.game.zone.ZoneType.Battlefield)) if(!oc.isLand() && oc.getCMC()<=c.getCMC() && (best==null || oc.getCMC()>best.getCMC())) best=oc;
              if(best!=null){ best.addTempController(me, game.getNextTimestamp()); game.getAction().controllerChangeZoneCorrection(best); } }
            c.addTempController(opp, game.getNextTimestamp()); game.getAction().controllerChangeZoneCorrection(c); exits[0]++;
            System.out.println("    HANDOFF "+c.getName()+" -> "+opp.getName()+" via "+how);
          } }
        if(e.phase()==forge.game.phase.PhaseType.END_OF_TURN && game.getNextPlayerAfter(ph.getPlayerTurn())==me){
          for(var c:new ArrayList<>(me.getCardsIn(forge.game.zone.ZoneType.Battlefield))) if((c.getName().equals("Demonic Pact")||c.getName().equals("Kobayashi Maru Scenario")) && c.getController()==me && pactUp.getOrDefault(c.getId(),0)>=3){
            forge.game.card.Card gift=null; for(var h:me.getCardsIn(forge.game.zone.ZoneType.Hand)) if(h.getName().equals("Generous Gift")) gift=h;
            List<forge.game.card.Card> src=new ArrayList<>(); for(var l:me.getCardsIn(forge.game.zone.ZoneType.Battlefield)) if(l.isLand() && l.isUntapped()) src.add(l);
            if(gift!=null && src.size()>=3){ for(int i=0;i<3;i++) src.get(i).tap(true,null,me); game.getAction().moveToGraveyard(gift,null); game.getAction().destroy(c,null,false,null); exits[0]++; }
            else exits[1]++;
          } } } });
      final Map<String,Integer> outAt=new LinkedHashMap<>(); final int[] tick={0};
      game.subscribeToEvents(new Object(){ @com.google.common.eventbus.Subscribe public void tb(forge.game.event.GameEventTurnBegan e){ tick[0]++;
          for(Player p:game.getRegisteredPlayers()) if(p.hasLost()) outAt.putIfAbsent(p.getName(),tick[0]); } });
      if(System.getProperty("dbg")!=null) game.subscribeToEvents(new Object(){ @com.google.common.eventbus.Subscribe public void on(forge.game.event.GameEventTurnBegan e){ for(Player p:game.getPlayers()) if(p.getName().equals(System.getProperty("dbg")) && e.turnOwner().toString().contains(p.getName())) System.out.println("  DBG T"+e.turnNumber()+" life="+p.getLife()+" hand="+p.getCardsIn(forge.game.zone.ZoneType.Hand)+" bf="+p.getCardsIn(forge.game.zone.ZoneType.Battlefield)); } });
      long s=System.currentTimeMillis(); String res2;
      ExecutorService ex=Executors.newSingleThreadExecutor(); Future<?> f=ex.submit(()->mc.startGame(game));
      try { f.get(timeout,TimeUnit.SECONDS); } catch(TimeoutException te){ try{ game.setGameOver(forge.game.GameEndReason.Draw);}catch(Throwable x){} f.cancel(true); try{ f.get(20,TimeUnit.SECONDS);}catch(Throwable x){} } catch(Exception e){ e.printStackTrace(); }
      ex.shutdownNow();
      int turn=game.getPhaseHandler().getTurn();
      if(game.getOutcome()==null || game.getOutcome().isDraw()) res2="Draw"; else res2=game.getOutcome().getWinningLobbyPlayer().getName();
      if(!game.isGameOver()) res2="Draw";
      if(trackedOut[0]) res2="TrackedOut";   // ended early once the tracked deck was eliminated (a loss for it)
      wins.merge(res2,1,Integer::sum);
      StringBuilder life=new StringBuilder(); for(Player p:game.getRegisteredPlayers()) life.append(p.getName().replaceAll(" .*","")).append("=").append(p.getLife()).append(p.hasLost()?"x ":" ");
      if(!use.isEmpty()){ StringBuilder ub=new StringBuilder("USE"); for(var en:use.entrySet()){ int[] r=en.getValue(); ub.append("\t").append(en.getKey()).append("~").append(r[0]).append("~").append(r[1]).append("~").append(r[2]).append("~").append(r[3]).append("~").append(r[4]); } System.out.println(ub); }
      System.out.println("POD "+pod.stream().map(Deck::getName).toList()); System.out.printf("G%d winner=%s turn=%d (round %.1f) %dms  %s%n", g+1, res2, turn, turn/(double)k, System.currentTimeMillis()-s, life);
      { int T=tick[0]+1; for(Player p:game.getRegisteredPlayers()) if(p.hasLost()) outAt.putIfAbsent(p.getName(),T);
        StringBuilder sb=new StringBuilder("PLACE "); for(Player p:game.getRegisteredPlayers()){ Integer o=outAt.get(p.getName()); sb.append(p.getName()).append(":").append(o==null?"alive":o).append(":").append(p.getLife()).append(" "); } System.out.println(sb); }
      System.out.println("OFF "+offs); if(dmgHook[0]!=null) dmgHook[0].run(); if(strat!=null) System.out.println("STRAT band="+band[0]+" pos="+pos[0]); if(pe!=null) System.out.println("PACTEXIT ok="+exits[0]+" fail="+exits[1]); System.out.println("DIL "+dil+" GROSS "+gross[0]); { StringBuilder sb=new StringBuilder("SEEN "); for(var en:seen.entrySet()) sb.append(en.getKey()).append("@").append(en.getValue()).append(";"); System.out.println(sb); }
      if(log){ var L=game.getGameLog().getLogEntries(null); Collections.reverse(L); for(var l:L) System.out.println("  | "+l); }
      System.out.flush();
    }
    System.out.println("RESULT "+wins);
    System.exit(0);
  }
}
