(() => {
  if (!document.body) return null;
  const cache = window.__jevFast ||= {ids:new WeakMap(), nodes:new Map(), next:1};
  const identity = e => {
    if (!cache.ids.has(e)) cache.ids.set(e,cache.next++);
    const id=cache.ids.get(e); cache.nodes.set(id,e); return id;
  };
  for (const [id,e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);
  const safe = e => !['password','file','hidden'].includes(e.type);
  const visible = e => !e.closest('[aria-hidden="true"],[inert]') &&
    e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  const name = (e,seen=new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    const referenced=(e.getAttribute('aria-labelledby')||'').split(/\s+/)
      .map(id=>name(document.getElementById(id),seen)).filter(Boolean).join(' ');
    return referenced || e.getAttribute('aria-label') ||
      [...(e.labels||[])].map(l=>name(l,seen)).filter(Boolean).join(' ') ||
      (['button','submit','reset'].includes(e.type) ? e.value : '') || e.getAttribute('alt') ||
      (e.tagName==='INPUT' ? '' : [...e.childNodes].map(n=>n.nodeType===3 ? n.textContent :
        n.nodeType===1 && n.getAttribute('aria-hidden')!=='true' ? name(n,seen) : '').join(' ').trim()) ||
      e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };
  const roles=['button','link','checkbox','radio','switch','tab','menuitem','menuitemradio',
    'option','gridcell','combobox','textbox','searchbox','spinbutton'];
  const selector='a[href],button,input,textarea,select,summary,[contenteditable="true"],'+
    roles.map(role=>'[role="'+role+'"]').join(',');
  const role = e => {
    const explicit=e.getAttribute('role');
    if (roles.includes(explicit)) return explicit;
    if (e.tagName==='BUTTON' || e.tagName==='SUMMARY') return 'button';
    if (e.tagName==='A') return 'link';
    if (e.tagName==='SELECT') return 'combobox';
    if (e.tagName==='TEXTAREA' || e.isContentEditable) return 'textbox';
    if (e.tagName==='INPUT') {
      if (['checkbox','radio'].includes(e.type)) return e.type;
      if (['button','submit','reset','image'].includes(e.type)) return 'button';
      if (e.type==='search') return 'searchbox';
      if (e.type==='number') return 'spinbutton';
      if (['text','email','url','tel'].includes(e.type)) return 'textbox';
    }
    return null;
  };
  cache.pageKey=()=>[performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    [...document.querySelectorAll('input,textarea,select')].filter(safe)
      .map(e=>[identity(e),e.value,e.checked,e.selectedIndex,e.disabled,e.readOnly])];
  cache.guard=e=>{
    if (!e?.isConnected || !visible(e)) return null;
    const scope=e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') || e.parentElement;
    return [identity(e),role(e),name(e),e.value??null,e.checked??null,e.selectedIndex??null,
      e.readOnly??null,e.matches(':disabled'),e.getAttribute('aria-disabled'),
      e.getAttribute('aria-expanded'),e.getAttribute('aria-checked'),e.getAttribute('aria-selected'),
      e.getAttribute('href'),scope?.innerText?.slice(0,6000)||'',
      e.scrollTop??null,e.clientHeight??null,e.scrollHeight??null];
  };
  const actions=[];
  for (const e of document.querySelectorAll(selector)) {
    if (!safe(e) || !visible(e) || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) continue;
    const r=e.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2, rname=role(e);
    if (!rname || r.width<=0 || r.height<=0) continue;
    if (rname==='gridcell' && e.querySelector('button,[role="button"]')) continue;
    const base={node:identity(e),role:rname,label:name(e)||rname,
      rect:{x:r.x,y:r.y,w:r.width,h:r.height},in_viewport:x>=0&&y>=0&&x<innerWidth&&y<innerHeight};
    for (const key of ['checked','selected','expanded']) {
      const value=e.getAttribute('aria-'+key);
      if (value!==null) base[key]=value;
    }
    if (['checkbox','radio'].includes(e.type)) base.checked=String(e.checked);
    if (e.tagName==='SELECT') {
      for (const o of e.options) if (!o.selected && !o.disabled && !o.closest('optgroup[disabled]'))
        actions.push({...base,kind:'select',value:o.value,
          current_value:[...e.selectedOptions].map(o=>o.label).join(', '),label:base.label+' → '+o.label});
    } else {
      const editable=!e.readOnly && e.getAttribute('aria-readonly')!=='true' &&
        (['textbox','searchbox','spinbutton'].includes(rname) ||
          (rname==='combobox' && ['INPUT','TEXTAREA'].includes(e.tagName)));
      const value='value' in e ? String(e.value) :
        e.isContentEditable || rname==='combobox' ? e.innerText.trim() : '';
      actions.push({...base,kind:editable?'fill':'click',value});
      if (editable) actions.push({...base,kind:'click',value,label:'Open '+base.label});
    }
  }
  const repeatedLabels=new Map();
  for (const a of actions) {
    const key=JSON.stringify([a.role,a.label]);
    if (!repeatedLabels.has(key)) repeatedLabels.set(key,new Set());
    repeatedLabels.get(key).add(a.node);
  }
  for (const a of actions) if (repeatedLabels.get(JSON.stringify([a.role,a.label])).size>1) {
    const e=cache.nodes.get(a.node);
    const scope=e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"],[role="listitem"]') || e.parentElement;
    a.context=(scope?.innerText||'').trim().replace(/\s+/g,' ').slice(0,180);
  }
  const words=[], walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const range=document.createRange(); let node,length=0;
  while ((node=walker.nextNode()) && length<6000) {
    const value=node.textContent.trim(), parent=node.parentElement;
    if (!value || !parent || parent.closest('script,style,noscript,template') || !visible(parent)) continue;
    range.selectNodeContents(node); const r=range.getBoundingClientRect();
    if (r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth) {
      words.push(value); length+=value.length;
    }
  }
  const text=words.join('\n').slice(0,6000), height=document.documentElement.scrollHeight;
  const root=document.scrollingElement || document.documentElement;
  const scrollAreas=[{
    element:root,
    label:'page',
    top:root.scrollTop,
    height:root.clientHeight,
    total:root.scrollHeight,
    root:true,
  }];
  for (const e of document.querySelectorAll('body *')) {
    if (e===root || !visible(e)) continue;
    const style=getComputedStyle(e), max=e.scrollHeight-e.clientHeight;
    if (max<=16 || !['auto','scroll','overlay'].includes(style.overflowY)) continue;
    const r=e.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom<=0 || r.top>=innerHeight || r.right<=0 || r.left>=innerWidth) continue;
    const landmark=e.tagName==='MAIN' || e.getAttribute('role')==='main' ? 'main content' :
      e.tagName==='ASIDE' || e.getAttribute('role')==='complementary' ? 'sidebar' : '';
    const label=(landmark || name(e) || e.innerText || 'scrollable region').trim().replace(/\s+/g,' ').slice(0,100);
    scrollAreas.push({element:e,label,top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight,root:false});
  }
  // Keep the main page and the eight largest visible nested regions in the action space.
  const nestedAreas=scrollAreas.slice(1).sort((a,b)=>
    Math.min(b.height,innerHeight)*Math.min(innerWidth,b.element.getBoundingClientRect().width)-
    Math.min(a.height,innerHeight)*Math.min(innerWidth,a.element.getBoundingClientRect().width)
  ).slice(0,8);
  const observedScrollAreas=[scrollAreas[0],...nestedAreas];
  const scrollStates=observedScrollAreas.map(area=>[
    identity(area.element),area.label,area.top,area.height,area.total
  ]);
  const page_key=cache.pageKey(), guards={};
  for (const a of actions) if (!(a.node in guards)) guards[a.node]=cache.guard(cache.nodes.get(a.node));
  // Compare meaning and identity. Geometry is always resolved and hit-tested just before input.
  const semantics=actions.map(({rect,...action})=>action);
  const marker=[performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    document.title,text,semantics,page_key[6],scrollStates];
  actions.forEach((a,i)=>a.order=i);
  const viewportActions=actions.filter(a=>a.in_viewport);
  const offscreenActions=actions.filter(a=>!a.in_viewport);
  const primaryRole=role=>['button','combobox','textbox','searchbox','spinbutton','checkbox','radio','switch'].includes(role);
  const distance=a=>{
    const x=a.rect.x+a.rect.w/2, y=a.rect.y+a.rect.h/2;
    const dx=x<0?-x:x>innerWidth?x-innerWidth:0;
    const dy=y<0?-y:y>innerHeight?y-innerHeight:0;
    return dx+dy;
  };
  const byUsefulness=(a,b)=>(Number(primaryRole(b.role))-Number(primaryRole(a.role)))||distance(a)-distance(b);
  // Preserve room for offscreen actions, so a control lower in a feed does not
  // disappear behind hundreds of viewport controls. Keep visible candidates first
  // and reserve at most 60 additional slots for the nearest actionable targets.
  const offscreenLimit=Math.min(60,offscreenActions.length,250);
  const viewportLimit=Math.min(viewportActions.length,250-offscreenLimit);
  let kept=[...viewportActions.sort(byUsefulness).slice(0,viewportLimit),
    ...offscreenActions.sort(byUsefulness).slice(0,offscreenLimit)];
  if (kept.length<250) {
    const chosen=new Set(kept);
    kept=[...kept,...viewportActions.filter(a=>!chosen.has(a)).sort(byUsefulness).slice(0,250-kept.length)];
  }
  kept.sort((a,b)=>a.order-b.order);
  const omitted_actions=Math.max(0,actions.length-kept.length);
  actions.splice(0,actions.length,...kept);
  actions.forEach(a=>delete a.order);
  actions.forEach((a,i)=>a.id='e'+(i+1));
  for (const [index,area] of observedScrollAreas.entries()) {
    const max=Math.max(0,area.total-area.height), delta=Math.max(160,Math.min(560,area.height*.75));
    const suffix=area.root?'page':`region_${index}`;
    if (area.top<max-2) actions.push({id:`scroll_down_${suffix}`,kind:'scroll',node:identity(area.element),
      label:`Scroll down · ${area.label}`,delta});
    if (area.top>2) actions.push({id:`scroll_up_${suffix}`,kind:'scroll',node:identity(area.element),
      label:`Scroll up · ${area.label}`,delta:-delta});
    guards[String(identity(area.element))]=cache.guard(area.element);
  }
  actions.push({id:'wait',kind:'wait',label:'Wait for the page to update'});
  return {url:location.href,title:document.title,w:innerWidth,h:innerHeight,text,
    scroll:{y:scrollY,height,areas:scrollStates},actions,marker,page_key,guards,omitted_actions};
})()
