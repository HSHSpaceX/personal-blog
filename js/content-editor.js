/* Shared visual editor: Community stores validated JSON; legacy retains trusted HTML. */
(function () {
  'use strict';
  var schema = window.CommunitySchema;
  var tools = [
    {label:'段落',block:'p',snippet:'<p>正文</p>'}, {label:'H2',block:'h2',snippet:'<h2>小标题</h2>'},
    {label:'H3',block:'h3',snippet:'<h3>小标题</h3>'}, {label:'粗体',cmd:'bold',snippet:'<strong>文字</strong>'},
    {label:'斜体',cmd:'italic',snippet:'<em>文字</em>'}, {label:'引用',block:'blockquote',snippet:'<blockquote>引用</blockquote>'},
    {label:'列表',cmd:'insertUnorderedList',snippet:'<ul><li>列表项</li></ul>'}, {label:'编号',cmd:'insertOrderedList',snippet:'<ol><li>列表项</li></ol>'},
    {label:'代码',block:'pre',snippet:'<pre>code</pre>'}, {label:'链接',cmd:'createLink'},
    {label:'图片',cmd:'insertLocalImage'}, {label:'视频',cmd:'insertLocalVideo'}, {label:'附件',cmd:'insertLocalFile'}
  ];
  function Editor_Create(options) {
    var editor=options.editor, toolbar=options.toolbar, text=options.textarea, legacy=!!options.legacy, lastText='', savedRange=null;
    editor.classList.add('rich-editor'); editor.setAttribute('role','textbox'); editor.setAttribute('aria-multiline','true');
    editor.setAttribute('contenteditable','true'); editor.setAttribute('aria-label',options.label||'正文编辑器');
    editor.dataset.editorCore='shared-v1'; toolbar.setAttribute('role','toolbar'); toolbar.setAttribute('aria-label','正文格式');
    function Editor_RememberSelection() { var selection=window.getSelection(); if(selection.rangeCount && editor.contains(selection.anchorNode))savedRange=selection.getRangeAt(0).cloneRange(); }
    function Editor_RestoreSelection() { editor.focus(); if(savedRange && editor.contains(savedRange.commonAncestorContainer)){var selection=window.getSelection();selection.removeAllRanges();selection.addRange(savedRange);} }
    function Editor_ReadRuns(parent,marks,href) {
      var runs=[];
      Array.from(parent.childNodes).forEach(function(n){
        if(n.nodeType===3){if(n.nodeValue){var run={text:n.nodeValue};if(marks.length)run.marks=marks.slice();if(href)run.href=href;runs.push(run);}return;}
        if(n.nodeType!==1)return;
        if(Array.from(n.attributes).some(function(a){return /^on/i.test(a.name);}))throw Error('正文包含事件处理器。');
        if(Array.from(n.attributes).some(function(a){return /^on/i.test(a.name);}) || !['BR','B','STRONG','I','EM','A','SPAN','DIV','P'].includes(n.tagName))throw Error('正文包含不支持或不安全的内容，请使用工具栏插入。');
        if(n.tagName==='BR'){runs.push({text:'\n'});return;}
        var next=marks.slice();if(['B','STRONG'].includes(n.tagName)&&!next.includes('bold'))next.push('bold');if(['I','EM'].includes(n.tagName)&&!next.includes('italic'))next.push('italic');
        var link=href;if(n.tagName==='A'){link=n.getAttribute('href');if(!schema.safeLink(link))throw Error('链接协议或地址不安全。');}
        runs=runs.concat(Editor_ReadRuns(n,next,link));
      });return runs;
    }
    function Editor_ReadDocument() {
      if(text && text.value!==lastText){Editor_SetBody({text:text.value});}
      var blocks=[],pending=[];
      function Editor_Flush() { if(pending.length){blocks.push({type:'paragraph',runs:pending});pending=[];} }
      Array.from(editor.childNodes).forEach(function(n){
        if(n.nodeType===3){if(n.nodeValue)pending.push({text:n.nodeValue});return;}
        if(n.nodeType!==1)return;
        if(n.dataset.contentAsset){Editor_Flush();if(n.tagName!=='P'||!schema.uuid(n.dataset.contentAsset))throw Error('无效资源引用。');blocks.push({type:'asset',asset_id:n.dataset.contentAsset});return;}
        if(['UL','OL'].includes(n.tagName)){Editor_Flush();var items=Array.from(n.children).map(function(li){if(li.tagName!=='LI')throw Error('无效列表。');return Editor_ReadRuns(li,[],null);});blocks.push({type:'list',ordered:n.tagName==='OL',items:items});return;}
        if(['P','DIV','H2','H3','BLOCKQUOTE','PRE'].includes(n.tagName)){Editor_Flush();var b={type:n.tagName==='H2'||n.tagName==='H3'?'heading':n.tagName==='BLOCKQUOTE'?'quote':n.tagName==='PRE'?'code':'paragraph',runs:Editor_ReadRuns(n,[],null)};if(b.type==='heading')b.level=Number(n.tagName.slice(1));blocks.push(b);return;}
        pending=pending.concat(Editor_ReadRuns({childNodes:[n]},[],null));
      });Editor_Flush();return {version:1,blocks:blocks};
    }
    function Editor_SyncText() { if(legacy)return;var doc=Editor_ReadDocument();lastText=schema.documentText(doc);if(text)text.value=lastText; }
    function Editor_SetBody(body) {
      savedRange=null;
      if(body.document){var refs=(body.asset_ids||[]).concat((body.photos||[]).map(function(p){return p.asset_id;})).map(function(id){return id.toLowerCase();});editor.innerHTML=schema.renderDocument(body.document,refs,options.maxLength||100000);}
      else {editor.replaceChildren();String(body.text||body.description||'').split(/\n\n/).forEach(function(value){var p=document.createElement('p');p.textContent=value;editor.appendChild(p);});}
      lastText=body.text||body.description||'';if(text)text.value=lastText;
    }
    function Editor_RunTool(tool) {
      Editor_RestoreSelection();
      if(options.sourceMode && options.sourceMode()){if(tool.snippet){var start=text.selectionStart||0,end=text.selectionEnd||0;text.setRangeText(tool.snippet,start,end,'end');text.focus();}else if(options.onTool)options.onTool(tool);return;}
      if(tool.cmd && (tool.cmd.startsWith('insertLocal')||tool.cmd==='insertFormula')){if(options.onTool)options.onTool(tool);return;}
      if(tool.cmd==='createLink'){var url=window.prompt('链接地址：','https://');if(!url)return;if(!schema.safeLink(url)){if(options.onError)options.onError('链接协议或地址不安全。');return;}document.execCommand('createLink',false,url);}
      else if(tool.block)document.execCommand('formatBlock',false,'<'+tool.block+'>');
      else document.execCommand(tool.cmd,false,false);
      Editor_RememberSelection();Editor_SyncText();if(options.onChange)options.onChange();
    }
    toolbar.replaceChildren();(legacy?tools.concat([{label:'公式',cmd:'insertFormula',snippet:'$$公式$$'}]):tools).forEach(function(tool){var b=document.createElement('button');b.type='button';b.className='btn';b.textContent=tool.label;b.dataset.editorTool=tool.cmd||tool.block;b.addEventListener('mousedown',function(e){e.preventDefault();Editor_RememberSelection();});b.addEventListener('click',function(){try{Editor_RunTool(tool);}catch(e){if(options.onError)options.onError(e.message);}});toolbar.appendChild(b);});
    try{document.execCommand('styleWithCSS',false,'false');}catch(error){/* DOM test runners lack editing commands. */}
    editor.addEventListener('input',function(){try{Editor_SyncText();if(options.onChange)options.onChange();}catch(e){if(options.onError)options.onError(e.message);}});
    editor.addEventListener('keyup',Editor_RememberSelection);editor.addEventListener('mouseup',Editor_RememberSelection);
    editor.addEventListener('paste',function(e){e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));Editor_SyncText();});
    editor.addEventListener('drop',function(e){e.preventDefault();});
    return {setBody:Editor_SetBody,getDocument:Editor_ReadDocument,clear:function(){editor.replaceChildren();lastText='';savedRange=null;if(text)text.value='';},
      getHTML:function(){return options.sourceMode&&options.sourceMode()?text.value:editor.innerHTML;},setHTML:function(html){if(!legacy)throw Error('Community 不接受 HTML。');savedRange=null;editor.innerHTML=html||'<p></p>';if(text)text.value=html||'<p></p>';},
      insertAsset:function(id){if(!schema.uuid(id))throw Error('无效资源 UUID。');Editor_RestoreSelection();var block=document.createElement('p');block.dataset.contentAsset=id;block.contentEditable='false';block.textContent='附件 · '+id;var anchor=savedRange&&savedRange.startContainer;while(anchor&&anchor.parentNode!==editor)anchor=anchor.parentNode;if(anchor&&anchor.parentNode===editor)editor.insertBefore(block,anchor.nextSibling);else editor.appendChild(block);savedRange=null;Editor_SyncText();if(options.onChange)options.onChange();},
      insertHTML:function(html){if(!legacy)throw Error('Community 不接受 HTML。');Editor_RestoreSelection();document.execCommand('insertHTML',false,html);if(options.onChange)options.onChange();}};
  }
  window.ContentEditor={create:Editor_Create};
})();
