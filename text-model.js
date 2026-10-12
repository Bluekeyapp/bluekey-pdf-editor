const rect=q=>({left:Math.min(...q.map(p=>p[0])),right:Math.max(...q.map(p=>p[0])),bottom:Math.min(...q.map(p=>p[1])),top:Math.max(...q.map(p=>p[1]))});
export function overlaps(a,b,pad=0){return a.left<b.right-pad&&a.right>b.left+pad&&a.bottom<b.top-pad&&a.top>b.bottom+pad;}
export function textBlocks(items){
 const blocks=[];let current;
 for(const item of items){
  if(item.type!=='text'||!item.editable||!item.text.trim()){current=null;continue;}
  const r=rect(item.quad),prev=current?.items.at(-1),pr=prev&&rect(prev.quad);
  const same=prev&&prev.root===item.root&&JSON.stringify(prev.path)===JSON.stringify(item.path)&&prev.label===item.label&&prev.color===item.color&&prev.size===item.size&&Math.abs(item.matrix[1])<.001&&Math.abs(item.matrix[2])<.001&&item.matrix.slice(0,4).every((v,i)=>Math.abs(v-prev.matrix[i])<.001);
  const em=item.size*Math.abs(item.matrix[3]);
  const inline=same&&Math.abs(item.matrix[5]-prev.matrix[5])<em*.15&&r.left-pr.right>=-1&&r.left-pr.right<em*.9;
  const newline=same&&prev.matrix[5]-item.matrix[5]>em*.8&&prev.matrix[5]-item.matrix[5]<em*1.85&&Math.abs(r.left-current.box.left)<em*.6;
  if(inline||newline){current.text+=(newline?'\n':(/\s$/.test(current.text)||/^\s/.test(item.text)||r.left-pr.right<em*.12?'':' '))+item.text;current.items.push(item);current.box={left:Math.min(current.box.left,r.left),right:Math.max(current.box.right,r.right),bottom:Math.min(current.box.bottom,r.bottom),top:Math.max(current.box.top,r.top)};}
  else {current={id:item.id,items:[item],text:item.text,box:r};blocks.push(current);}
 }
 return blocks.filter(b=>b.items.length>1);
}
export function collisionItems(item,layout,items,excluded=[]){
 const [a,b,c,d,e,f]=item.matrix,point=(x,y)=>[a*x+c*y+e,b*x+d*y+f];
 const q=[[0,item.rise-layout.size*.22-(layout.lines.length-1)*layout.size*layout.lineHeight],[layout.width,item.rise-layout.size*.22-(layout.lines.length-1)*layout.size*layout.lineHeight],[layout.width,item.rise+layout.size*.93],[0,item.rise+layout.size*.93]].map(p=>point(...p));
 const box=rect(q),original=rect(item.quad);return items.filter(i=>i.id!==item.id&&!excluded.includes(i.id)&&(i.type==='text'?i.text.trim():i.type==='image'&&!overlaps(original,rect(i.quad),1))&&overlaps(box,rect(i.quad),1));
}
export function analyzeRoutes(items,recovered=0){const text=items.filter(i=>i.type==='text');return {direct:text.filter(i=>i.editable).length,rebuild:text.filter(i=>!i.editable).length+recovered,images:items.filter(i=>i.type==='image').length,scan:!text.some(i=>i.text.trim())};}
