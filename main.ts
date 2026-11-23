import{mkdirSync,readdirSync,readFileSync,writeFileSync}from'node:fs';
import{join}from'node:path';
const I=process.env.MAKEFUN_INPUT_DIR||'/input',O=process.env.MAKEFUN_OUTPUT_DIR||'/output';
const D=[[0,-1,'u'],[0,1,'d'],[-1,0,'l'],[1,0,'r']];
function A(W,N,p){let r=[];for(let[dx,dy,c]of D){if(dx<0&&p%W==0||dx>0&&p%W==W-1)continue;let n=p+dy*W+dx;if(n>=0&&n<N)r.push([n,c]);}return r;}
function walk(W,N,blocked,a,b){
 if(a==b)return'';
 let P=new Int32Array(N).fill(-1),H=new Array(N),q=[a];P[a]=a;
 for(let i=0;i<q.length;i++)for(let[n,c]of A(W,N,q[i])){
  if(P[n]>=0||blocked(n))continue;
  P[n]=q[i];H[n]=c;
  if(n==b){let s='';for(let x=b;x!=a;x=P[x])s=H[x]+s;return s;}
  q.push(n);
 }
 return null;
}
function flood(W,N,wall,inRoom,occ,from){
 let s=new Set([from]),l=from,st=[from];
 while(st.length){let p=st.pop();if(p<l)l=p;
  for(let[n]of A(W,N,p))if(!wall[n]&&inRoom[n]&&!occ[n]&&!s.has(n)){s.add(n);st.push(n);}}
 return{l,s};
}
function dead(W,N,wall,inRoom,goals){
 let d=new Int32Array(N).fill(-1),q=[];
 for(let g of goals){d[g]=0;q.push(g);}
 for(let i=0;i<q.length;i++)for(let[n]of A(W,N,q[i])){
  let s=2*q[i]-n,ps=3*q[i]-2*n;
  if(s<0||s>=N||ps<0||ps>=N||wall[s]||!inRoom[s]||wall[ps]||!inRoom[ps]||d[s]>=0)continue;
  d[s]=d[q[i]]+1;q.push(s);
 }
 return d;
}
function room(W,N,wall,inRoom,goals,boxes,player,cap){
 let gs=new Set(goals),md=dead(W,N,wall,inRoom,goals);
 for(let b of boxes)if(md[b]<0)return null;
 let st=boxes.slice().sort((a,b)=>a-b);
 if(st.every(b=>gs.has(b)))return{m:'',e:player};
 let occ=new Uint8Array(N),B=[st],PL=[player],PA=[-1],PC=[''],Q=[0],seen=new Set();
 for(let b of st)occ[b]=1;
 let f0=flood(W,N,wall,inRoom,occ,player);
 for(let b of st)occ[b]=0;
 seen.add(st.join()+':'+f0.l);
 let exp=0;
 for(let h=0;h<Q.length;h++){
  let i=Q[h],bs=B[i];
  if(bs.every(b=>gs.has(b))){
   let path=[];for(let s=i;s>0;s=PA[s])path.push(s);path.reverse();
   let m='',pl=player,cur=st;
   for(let s of path){
    let nb=B[s],from=cur.find(b=>!nb.includes(b)),to=nb.find(b=>!cur.includes(b));
    for(let b of cur)occ[b]=1;
    let w=walk(W,N,q=>q<0||q>=N||wall[q]||!inRoom[q]||occ[q],pl,2*from-to);
    for(let b of cur)occ[b]=0;
    if(w==null)return null;
    m+=w+PC[s];pl=from;cur=nb;
   }
   return{m,e:pl};
  }
  if(++exp>cap)return null;
  for(let b of bs)occ[b]=1;
  let fl=flood(W,N,wall,inRoom,occ,PL[i]);
  for(let bi=0;bi<bs.length;bi++){let b=bs[bi];
   for(let[t,c]of A(W,N,b)){
    if(md[t]<0||!fl.s.has(2*b-t)||wall[t]||!inRoom[t]||occ[t])continue;
    let nb=bs.slice();nb[bi]=t;nb.sort((a,b2)=>a-b2);
    occ[b]=0;occ[t]=1;
    let nf=flood(W,N,wall,inRoom,occ,b);
    occ[t]=0;occ[b]=1;
    let k=nb.join()+':'+nf.l;
    if(seen.has(k))continue;
    seen.add(k);B.push(nb);PL.push(b);PA.push(i);PC.push(c);Q.push(B.length-1);
   }
  }
  for(let b of bs)occ[b]=0;
 }
 return null;
}
function solve(text){
 let rows=text.split('\n').filter(r=>r.length),H=rows.length,W=Math.max(...rows.map(r=>r.length)),N=W*H;
 let wall=new Uint8Array(N).fill(1),goals=[],boxes=[],player=-1;
 for(let y=0;y<H;y++)for(let x=0;x<rows[y].length;x++){
  let c=rows[y][x],i=y*W+x;
  if(c=='#')continue;
  wall[i]=0;
  if(c=='.'||c=='*'||c==='+')goals.push(i);
  if(c=='$'||c=='*')boxes.push(i);
  if(c=='@'||c=='+')player=i;
 }
 let hr=(player/W)|0,comp=new Int32Array(N).fill(-1),rooms=[];
 for(let s=0;s<N;s++){
  if(wall[s]||((s/W)|0)==hr||comp[s]>=0)continue;
  let sq=[s];comp[s]=rooms.length;
  for(let k=0;k<sq.length;k++)for(let[n]of A(W,N,sq[k])){
   if(wall[n]||((n/W)|0)==hr||comp[n]>=0)continue;
   comp[n]=rooms.length;sq.push(n);
  }
  rooms.push({sq,b:[],g:[]});
 }
 for(let b of boxes){let c=comp[b];if(c<0)return'';rooms[c].b.push(b);}
 for(let g of goals){let c=comp[g];if(c<0)return'';rooms[c].g.push(g);}
 let moves='',pl=player,cur=boxes.slice(),occ=new Uint8Array(N);
 for(let r of rooms){
  if(!r.b.length){if(r.g.length)return'';continue;}
  if(r.b.length!=r.g.length)return'';
  let doors=r.sq.filter(s=>Math.abs(((s/W)|0)-hr)==1);
  let door=doors.find(s=>!r.b.includes(s))||doors[0];
  if(door==null)return'';
  let entry=door+(hr-((door/W)|0))*W;
  if(wall[entry])return'';
  for(let b of cur)occ[b]=1;
  let w=walk(W,N,q=>q<0||q>=N||wall[q]||occ[q],pl,entry);
  for(let b of cur)occ[b]=0;
  if(w==null)return'';
  moves+=w;pl=entry;
  let inRoom=new Uint8Array(N);
  for(let s of r.sq)inRoom[s]=1;
  for(let x=0;x<W;x++){let s=hr*W+x;if(!wall[s])inRoom[s]=1;}
  let res=room(W,N,wall,inRoom,r.g,r.b,pl,300000);
  if(!res)return'';
  moves+=res.m;pl=res.e;
  cur=cur.filter(b=>!r.b.includes(b)).concat(r.g);
 }
 return moves;
}
for(let id of readdirSync(I).sort()){
 let m=solve(readFileSync(join(I,id,'level.txt'),'utf8'));
 mkdirSync(join(O,id),{recursive:true});
 writeFileSync(join(O,id,'solution.txt'),m+'\n');
}
