const workflowState={followUps:[],waitingEntries:[],deliveries:[],selectedProviderApiId:null,composePatientApiId:'',composeProviderApiId:'',composeSubject:'Message from WannaTalk',composeMessage:''};

function workflowStyles(){
  if($('workflowStyles'))return;
  document.head.insertAdjacentHTML('beforeend',`<style id="workflowStyles">
    .wa-btn{display:none!important}.workflow-layout{display:grid;grid-template-columns:minmax(230px,280px) minmax(0,1fr);gap:18px;align-items:start}.workflow-list{display:grid;gap:9px}.workflow-list-button{width:100%;border:1px solid var(--line);border-radius:13px;background:#fff;padding:12px;text-align:left;cursor:pointer;color:var(--text)}.workflow-list-button:hover,.workflow-list-button.active{border-color:#16a56f;background:var(--green-soft)}.workflow-actions{display:flex;gap:8px;flex-wrap:wrap}.workflow-checks{display:flex;gap:16px;flex-wrap:wrap;padding:12px;border:1px solid var(--line);border-radius:11px}.workflow-checks label{display:flex;align-items:center;gap:7px}.workflow-checks input{width:auto}.workflow-row-actions{display:flex;gap:7px;flex-wrap:wrap}.workflow-private-note{background:#fff8df;border:1px solid #f2dea1;color:#705100;padding:12px;border-radius:12px}.workflow-delivery{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.workflow-delivery .status{padding:5px 8px}.workflow-message{white-space:pre-wrap;line-height:1.55}.workflow-modal-wide{width:min(760px,100%)}.meeting-link-box{border:1px solid #bfe9d5;background:#eefbf4;color:#08704c;border-radius:12px;padding:12px;margin-top:14px}.meeting-link-box strong{display:block;margin-bottom:4px}.meeting-link-box a{color:#08704c;font-weight:900}.online-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;background:#e8f7ff;color:#075f91;padding:4px 8px;font-size:11px;font-weight:900;margin-top:5px}.month-event.unavailable,.month-event.blocked{border-color:#8a9bad!important;background:#edf2f6!important;color:#607082!important;cursor:not-allowed}.month-event.available{border-color:#0c9b68!important;background:#dff8ed!important;color:#08704c!important}.month-event.past{border-color:#df3333!important;background:#ffe4e4!important;color:#bd1d1d!important;cursor:not-allowed}@media(max-width:900px){.workflow-layout{grid-template-columns:1fr}}
  </style>`);
}

function workflowChannels(prefix,selected=['email']){
  return `<div class="workflow-checks"><label><input id="${prefix}Email" type="checkbox" ${selected.includes('email')?'checked':''}> Email</label><label><input id="${prefix}Sms" type="checkbox" ${selected.includes('sms')?'checked':''}> SMS</label></div>`;
}
function selectedWorkflowChannels(prefix){return [['Email','email'],['Sms','sms']].filter(([suffix])=>$(prefix+suffix)?.checked).map(([,channel])=>channel)}
function workflowDateTime(dateValue,timeValue){return new Date(`${dateValue}T${timeValue}:00`).toISOString()}
function workflowStatus(status){let key=status==='open'||status==='active'||status==='sent'?'confirmed':status==='failed'||status==='cancelled'?'cancelled':'completed';return `<span class="status ${key}">${escapeAccountText(status)}</span>`}
function providerByApiId(apiId){return data.providers.find(item=>item.apiId===apiId)}
function patientByApiId(apiId){return data.patients.find(item=>item.apiId===apiId)}

async function loadWorkflowState(){
  if(!session)return;
  let requests=[];
  if(['admin','provider'].includes(session.role))requests.push(apiRequest('/follow-ups').then(payload=>workflowState.followUps=payload.followUps||[]));
  requests.push(apiRequest('/waiting-list').then(payload=>workflowState.waitingEntries=payload.entries||[]));
  if(['admin','provider'].includes(session.role))requests.push(apiRequest('/communications').then(payload=>workflowState.deliveries=payload.deliveries||[]));
  await Promise.all(requests);
}

function workflowPatientOptions(selected=''){return data.patients.filter(item=>item.active!==false).map(item=>`<option value="${item.apiId}" ${item.apiId===selected?'selected':''}>${escapeAccountText(item.name)} · ${escapeAccountText(item.email)}</option>`).join('')}
function workflowProviderOptions(selected=''){return data.providers.filter(item=>item.active!==false).map(item=>`<option value="${item.apiId}" ${item.apiId===selected?'selected':''}>${escapeAccountText(item.name)}</option>`).join('')}

function setupWorkflowUI(){
  workflowStyles();
  if($('adminStatusFilter')&&!$('adminAppointmentSort')){
    $('adminStatusFilter').insertAdjacentHTML('afterend','<select id="adminAppointmentSort" onchange="renderAdminAppointments()"><option value="soonest">Sort: soonest first</option><option value="latest">Sort: latest first</option></select>');
  }
  let adminNav=document.querySelector('#adminShell .nav'),adminMain=document.querySelector('#adminShell main');
  if(adminNav&&!adminNav.querySelector('[data-aview="providers"]')){
    let appointments=adminNav.querySelector('[data-aview="appointments"]');appointments?.insertAdjacentHTML('afterend','<button data-aview="providers" onclick="showA(\'providers\',this)">◉ Providers</button>');
    let availability=adminNav.querySelector('[data-aview="availability"]');availability?.insertAdjacentHTML('afterend','<button data-aview="followups" onclick="showA(\'followups\',this)">✓ Follow-ups</button><button data-aview="waiting" onclick="showA(\'waiting\',this)">◷ Waiting list</button><button data-aview="messages" onclick="showA(\'messages\',this)">✉ Messages</button>');
  }
  if(adminMain&&!$('a-providers'))adminMain.insertAdjacentHTML('beforeend','<section id="a-providers" class="section"><div class="section-title"><div><h2>Registered providers</h2><p>View, update, deactivate, or reactivate provider accounts.</p></div><span class="pill" id="adminProviderSummary"></span></div><div id="adminProvidersDirectory"></div></section><section id="a-followups" class="section"><div id="adminFollowUps"></div></section><section id="a-waiting" class="section"><div id="adminWaitingList"></div></section><section id="a-messages" class="section"><div id="adminMessages"></div></section>');
  let providerNav=document.querySelector('#providerShell .nav'),providerMain=document.querySelector('#providerShell main'),messageButton=providerNav?.querySelector('[data-pview="messages"]');if(messageButton)messageButton.textContent='✉ Messages';
  if(providerNav&&!providerNav.querySelector('[data-pview="followups"]'))messageButton?.insertAdjacentHTML('beforebegin','<button data-pview="followups" onclick="showP(\'followups\',this)">✓ Follow-ups</button>');
  if(providerMain&&!$('p-followups'))providerMain.insertAdjacentHTML('beforeend','<section id="p-followups" class="section"><div id="providerFollowUps"></div></section>');
  if($('p-messages'))$('p-messages').innerHTML='<div id="providerMessagesWorkflow"></div>';
  let patientNav=document.querySelector('#patientShell .nav'),patientMain=document.querySelector('#patientShell main');
  if(patientNav&&!patientNav.querySelector('[data-uview="waiting"]'))patientNav.querySelector('[data-uview="appointments"]')?.insertAdjacentHTML('afterend','<button data-uview="waiting" onclick="showU(\'waiting\',this)">◷ Cancellation list</button>');
  if(patientMain&&!$('u-waiting'))patientMain.insertAdjacentHTML('beforeend','<section id="u-waiting" class="section"><div id="patientWaitingList"></div></section>');
  setContactOptions($('upContact'));setContactOptions($('arClientContact'));
  document.querySelectorAll('label').forEach(label=>{if(label.textContent.trim()==='Mobile / WhatsApp')label.textContent='Mobile / SMS'});
}

function setContactOptions(select){if(!select)return;let current=select.value==='WhatsApp'||select.value==='Phone'?'SMS':select.value||'Email';select.innerHTML=['Email','SMS','Both'].map(value=>`<option ${value===current?'selected':''}>${value}</option>`).join('')}

const legacyBuildRegister=buildRegister;
buildRegister=function(){legacyBuildRegister();setContactOptions($('rContact'))};
const legacyOpenAdminPatientEditor=openAdminPatientEditor;
openAdminPatientEditor=function(patientApiId){legacyOpenAdminPatientEditor(patientApiId);setContactOptions($('editPatientContact'));let label=document.querySelector('label[for="editPatientMobile"]');if(label)label.textContent='Mobile / SMS'};

const legacyShowA=showA;
showA=function(view,button){
  if(!['providers','followups','waiting','messages'].includes(view))return legacyShowA(view,button);
  document.querySelectorAll('#adminShell .section').forEach(item=>item.classList.remove('active'));$('a-'+view).classList.add('active');document.querySelectorAll('[data-aview]').forEach(item=>item.classList.remove('active'));(button||document.querySelector(`[data-aview="${view}"]`))?.classList.add('active');
  $('aTitle').textContent={providers:'Providers',followups:'Follow-ups',waiting:'Waiting list',messages:'Messages'}[view];
  if(view==='providers')renderAdminProviders();if(view==='followups')renderFollowUps('admin');if(view==='waiting')renderAdminWaitingList();if(view==='messages')renderMessages('admin');
};
const legacyShowP=showP;
showP=function(view,button){
  if(!['followups','messages'].includes(view))return legacyShowP(view,button);
  document.querySelectorAll('#providerShell .section').forEach(item=>item.classList.remove('active'));$('p-'+view).classList.add('active');document.querySelectorAll('[data-pview]').forEach(item=>item.classList.remove('active'));(button||document.querySelector(`[data-pview="${view}"]`))?.classList.add('active');$('pTitle').textContent=view==='followups'?'Follow-ups':'Messages';
  if(view==='followups')renderFollowUps('provider');else renderMessages('provider');
};
const legacyShowU=showU;
showU=function(view,button){
  if(view!=='waiting')return legacyShowU(view,button);
  document.querySelectorAll('#patientShell .section').forEach(item=>item.classList.remove('active'));$('u-waiting').classList.add('active');document.querySelectorAll('[data-uview]').forEach(item=>item.classList.remove('active'));(button||document.querySelector('[data-uview="waiting"]'))?.classList.add('active');$('uTitle').textContent='Cancellation list';renderPatientWaitingList();
};

async function renderAdminProviders(){
  let target=$('adminProvidersDirectory');target.innerHTML='<article class="card"><div class="field" style="max-width:420px;margin-bottom:16px"><label for="adminProviderSearch">Search providers</label><input id="adminProviderSearch" type="search" placeholder="Name, email, mobile or title" oninput="renderAdminProviderTable()"></div><div id="adminProviderTable" class="dashboard-table"><div class="notice">Loading providers…</div></div></article>';await loadWorkflowState();renderAdminProviderTable();
}
function renderAdminProviderTable(){
  let table=$('adminProviderTable'),summary=$('adminProviderSummary');if(!table||!summary)return;let search=String($('adminProviderSearch')?.value||'').trim().toLowerCase(),providers=[...data.providers].sort((left,right)=>left.name.localeCompare(right.name)),activeCount=providers.filter(provider=>provider.active!==false).length,filtered=providers.filter(provider=>!search||[provider.name,provider.email,provider.mobile,provider.role,(provider.locations||[]).join(' ')].some(value=>String(value||'').toLowerCase().includes(search)));
  summary.textContent=`${activeCount} active · ${providers.length-activeCount} inactive · ${providers.length} total`;
  table.innerHTML=filtered.length?`<table><thead><tr><th>Provider</th><th>Contact</th><th>Locations</th><th>Appointments</th><th>Patients</th><th>Status</th><th>Actions</th></tr></thead><tbody>${filtered.map(provider=>{let appointments=data.appointments.filter(item=>item.providerId===provider.id),patients=new Set(appointments.map(item=>item.patientId));return `<tr><td><span class="patient-name">${escapeAccountText(provider.name)}</span><div class="sub">${escapeAccountText(provider.role||'Provider')} · ${escapeAccountText(provider.duration||60)} minutes</div></td><td>${escapeAccountText(provider.email)}<div class="sub">${escapeAccountText(provider.mobile||'No mobile')}</div></td><td>${escapeAccountText((provider.locations||[]).join(', ')||'No locations')}</td><td>${appointments.length}</td><td>${patients.size}</td><td><span class="status ${provider.active===false?'cancelled':providerOnline(provider)?'confirmed':'completed'}">${provider.active===false?'Inactive':providerOnline(provider)?'Online':'Offline'}</span></td><td><div class="workflow-row-actions"><button class="btn secondary" style="padding:8px 10px" onclick="openAdminProviderEditor('${provider.apiId}')">Edit</button><button class="btn secondary" style="padding:8px 10px" onclick="openAdminProviderCalendar('${provider.apiId}')">Calendar</button>${provider.active===false?`<button class="btn" style="padding:8px 10px" onclick="reactivateProvider('${provider.apiId}')">Reactivate</button>`:`<button class="btn danger" style="padding:8px 10px" onclick="deactivateProvider('${provider.apiId}')">Deactivate</button>`}</div></td></tr>`}).join('')}</tbody></table>`:'<div class="notice">No providers match this search.</div>';
}
function openAdminProviderCalendar(providerApiId){selectedAdminAvailabilityProviderApiId=providerApiId;showA('availability')}

async function renderFollowUps(role){
  let target=$(role==='admin'?'adminFollowUps':'providerFollowUps');target.innerHTML='<div class="notice">Loading follow-ups…</div>';await loadWorkflowState();let items=workflowState.followUps;
  target.innerHTML=`<div class="section-title"><div><h2>Follow-ups</h2><p>Internal notes remain private. Only the reminder message is sent.</p></div><button class="btn" onclick="openFollowUpModal()">＋ Create follow-up</button></div><div class="card dashboard-table">${items.length?`<table><thead><tr><th>Patient</th><th>Provider</th><th>Due</th><th>Internal note</th><th>Reminder</th><th>Status</th><th>Actions</th></tr></thead><tbody>${items.map(item=>`<tr><td><span class="patient-name">${escapeAccountText(item.patient_name)}</span></td><td>${escapeAccountText(item.provider_name)}</td><td>${escapeAccountText(new Date(item.due_at).toLocaleString('en-ZA'))}</td><td><div class="workflow-private-note">${escapeAccountText(item.internal_note||'No internal note')}</div></td><td>${escapeAccountText((item.reminder_channels||[]).join(' + ')||'None')}<div class="sub">${item.reminder_sent_at?'Sent '+new Date(item.reminder_sent_at).toLocaleString('en-ZA'):'Not sent'}</div></td><td>${workflowStatus(item.status)}</td><td><div class="workflow-row-actions">${item.status==='open'?`<button class="btn" style="padding:8px 10px" onclick="sendFollowUpReminder('${item.id}')">Send reminder</button><button class="btn secondary" style="padding:8px 10px" onclick="setFollowUpStatus('${item.id}','completed')">Complete</button><button class="btn secondary" style="padding:8px 10px" onclick="setFollowUpStatus('${item.id}','cancelled')">Cancel</button>`:''}</div></td></tr>`).join('')}</tbody></table>`:'<div class="notice">No follow-ups have been created.</div>'}</div>`;
}

function closeFollowUpModal(){$('followUpModal')?.remove()}
function openFollowUpModal(patientApiId='',providerApiId=''){
  ensureBookingModalStyles();closeFollowUpModal();let provider=session?.role==='provider'?currentProvider()?.apiId:providerApiId,date=new Date();date.setDate(date.getDate()+1);let dateValue=date.toISOString().slice(0,10);
  document.body.insertAdjacentHTML('beforeend',`<div id="followUpModal" class="modal-backdrop" onclick="if(event.target.id==='followUpModal')closeFollowUpModal()"><article class="modal-card workflow-modal-wide"><div class="card-head"><div><h3 style="margin:0">Create follow-up</h3><div class="sub">Plan the follow-up and choose the reminder channel.</div></div><button class="btn secondary" onclick="closeFollowUpModal()">Close</button></div><div class="notice">The internal note is private and is never included in Email or SMS messages.</div><div class="form-grid"><div class="field"><label>Patient</label><select id="followUpPatient">${workflowPatientOptions(patientApiId)}</select></div><div class="field"><label>Assigned provider</label><select id="followUpProvider" ${session?.role==='provider'?'disabled':''}>${workflowProviderOptions(provider)}</select></div><div class="field"><label>Follow-up date</label><input id="followUpDate" type="date" min="${todayStr()}" value="${dateValue}"></div><div class="field"><label>Time</label><input id="followUpTime" type="time" value="10:00"></div><div class="field full"><label>Private internal note</label><textarea id="followUpInternalNote" maxlength="2000"></textarea></div><div class="field full"><label>Patient reminder message</label><textarea id="followUpReminderMessage" maxlength="1000">WannaTalk reminder: please contact us to arrange your recommended follow-up session.</textarea></div><div class="field full"><label>Reminder channel</label>${workflowChannels('followUpChannel',['email','sms'])}</div></div><div class="modal-actions"><button class="btn secondary" onclick="closeFollowUpModal()">Cancel</button><button class="btn" onclick="createFollowUp()">Save follow-up</button></div></article></div>`);
}
async function createFollowUp(){let channels=selectedWorkflowChannels('followUpChannel');if(!channels.length)return toast('Choose Email, SMS, or both');try{await apiRequest('/follow-ups',{method:'POST',body:JSON.stringify({patientId:$('followUpPatient').value,providerId:$('followUpProvider').value,dueAt:workflowDateTime($('followUpDate').value,$('followUpTime').value),internalNote:$('followUpInternalNote').value.trim(),reminderMessage:$('followUpReminderMessage').value.trim(),reminderChannels:channels})});closeFollowUpModal();await renderFollowUps(session.role==='admin'?'admin':'provider');toast('Follow-up saved')}catch(error){toast(error.message)}}
async function setFollowUpStatus(id,status){try{await apiRequest(`/follow-ups/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});await renderFollowUps(session.role==='admin'?'admin':'provider');toast(`Follow-up ${status}`)}catch(error){toast(error.message)}}
async function sendFollowUpReminder(id){if(!confirm('Send this follow-up reminder now?'))return;try{let result=await apiRequest(`/follow-ups/${id}/send`,{method:'POST',body:'{}'}),sent=result.deliveries.filter(item=>item.status==='sent').length,failed=result.deliveries.length-sent;await renderFollowUps(session.role==='admin'?'admin':'provider');toast(`${sent} delivered${failed?` · ${failed} failed`:''}`)}catch(error){toast(error.message)}}

function messageForm(role){let provider=session?.role==='provider'?currentProvider():null;return `<div class="grid two"><article class="card"><div class="card-head"><h3>Send patient message</h3><span class="pill">Email / SMS</span></div><div class="form-grid"><div class="field full"><label>Patient</label><select id="messagePatient">${workflowPatientOptions(workflowState.composePatientApiId)}</select></div>${role==='admin'?`<div class="field full"><label>Provider</label><select id="messageProvider"><option value="">Practice administration</option>${workflowProviderOptions(workflowState.composeProviderApiId)}</select></div>`:''}<div class="field full"><label>Subject</label><input id="messageSubject" maxlength="160" value="${escapeAccountText(workflowState.composeSubject)}"></div><div class="field full"><label>Message</label><textarea id="messageText" maxlength="1000">${escapeAccountText(workflowState.composeMessage)}</textarea></div><div class="field full"><label>Send by</label>${workflowChannels('messageChannel',['email','sms'])}</div></div><button class="btn" style="margin-top:16px" onclick="sendWorkflowMessage()">Send message</button></article><article class="card"><div class="card-head"><h3>Privacy reminder</h3></div><div class="notice">Use Email and SMS for appointment information and general follow-up reminders. Do not include detailed clinical notes.</div><div class="detail-list"><div class="detail-row"><span>Sender</span><strong>${escapeAccountText(provider?.name||'WannaTalk Administration')}</strong></div><div class="detail-row"><span>Delivery</span><strong>Audited</strong></div><div class="detail-row"><span>WhatsApp</span><strong>Removed</strong></div></div></article></div>`}
async function renderMessages(role){let target=$(role==='admin'?'adminMessages':'providerMessagesWorkflow');target.innerHTML='<div class="notice">Loading messages…</div>';await loadWorkflowState();let deliveries=[...workflowState.deliveries].sort((left,right)=>String(right.created_at||'').localeCompare(String(left.created_at||'')));target.innerHTML=`<div class="section-title"><div><h2>Messages</h2><p>Send patient communication through the configured WannaTalk Email and SMS services.</p></div></div>${messageForm(role)}<div class="card dashboard-table" style="margin-top:18px"><div class="card-head"><h3>Delivery history</h3><span class="pill">${deliveries.length}</span></div>${deliveries.length?`<table><thead><tr><th>Patient</th><th>Channel</th><th>Subject</th><th>Sent</th><th>Status</th><th>Actions</th></tr></thead><tbody>${deliveries.map(item=>`<tr ondblclick="openMessageDetail('${item.id}')" title="Double-click to view message"><td>${escapeAccountText(item.patient_name)}</td><td>${escapeAccountText(item.channel.toUpperCase())}</td><td>${escapeAccountText(item.subject||'WannaTalk message')}</td><td>${escapeAccountText(new Date(item.created_at).toLocaleString('en-ZA'))}</td><td>${workflowStatus(item.status)}${item.error_message?`<div class="sub">${escapeAccountText(item.error_message)}</div>`:''}</td><td><button class="btn secondary" style="padding:8px 10px" onclick="event.stopPropagation();openMessageDetail('${item.id}')">View</button></td></tr>`).join('')}</tbody></table>`:'<div class="notice">No Email or SMS messages have been sent yet.</div>'}</div>`}
function closeMessageDetail(){$('messageDetailModal')?.remove()}
function openMessageDetail(id){let item=workflowState.deliveries.find(delivery=>String(delivery.id)===String(id));if(!item)return toast('Message not found');ensureBookingModalStyles();closeMessageDetail();document.body.insertAdjacentHTML('beforeend',`<div id="messageDetailModal" class="modal-backdrop" onclick="if(event.target.id==='messageDetailModal')closeMessageDetail()"><article class="modal-card workflow-modal-wide"><div class="card-head"><div><h3 style="margin:0">Message details</h3><div class="sub">${escapeAccountText(new Date(item.created_at).toLocaleString('en-ZA'))}</div></div><button class="btn secondary" onclick="closeMessageDetail()">Close</button></div><div class="detail-list"><div class="detail-row"><span>Patient</span><strong>${escapeAccountText(item.patient_name||'Patient')}</strong></div><div class="detail-row"><span>Provider</span><strong>${escapeAccountText(item.provider_name||'Practice administration')}</strong></div><div class="detail-row"><span>Channel</span><strong>${escapeAccountText(String(item.channel||'').toUpperCase())}</strong></div><div class="detail-row"><span>Recipient</span><strong>${escapeAccountText(item.recipient||'Unavailable')}</strong></div><div class="detail-row"><span>Status</span><strong>${escapeAccountText(item.status||'')}</strong></div></div><div class="card" style="box-shadow:none;margin-top:16px"><div class="card-head"><h3 style="margin:0">${escapeAccountText(item.subject||'WannaTalk message')}</h3></div><div class="workflow-message">${escapeAccountText(item.message_text||'No message body recorded')}</div>${item.error_message?`<div class="notice" style="margin-top:14px">${escapeAccountText(item.error_message)}</div>`:''}</div></article></div>`)}
async function sendWorkflowMessage(){let channels=selectedWorkflowChannels('messageChannel'),message=$('messageText').value.trim();if(!channels.length||!message)return toast('Enter a message and choose Email, SMS, or both');try{let result=await apiRequest('/communications/send',{method:'POST',body:JSON.stringify({patientId:$('messagePatient').value,providerId:$('messageProvider')?.value||currentProvider()?.apiId||null,channels,subject:$('messageSubject').value.trim(),message})}),sent=result.deliveries.filter(item=>item.status==='sent').length,failed=result.deliveries.length-sent;workflowState.composeSubject='Message from WannaTalk';workflowState.composeMessage='';await renderMessages(session.role);toast(`${sent} delivered${failed?` · ${failed} failed`:''}`)}catch(error){toast(error.message)}}
function openWorkflowMessages(patientApiId='',subject='Message from WannaTalk',message='',providerApiId='',role=session?.role){workflowState.composePatientApiId=patientApiId;workflowState.composeProviderApiId=providerApiId;workflowState.composeSubject=subject;workflowState.composeMessage=message;if(role==='admin')showA('messages');else showP('messages')}

async function renderPatientWaitingList(){let target=$('patientWaitingList');target.innerHTML='<div class="notice">Loading cancellation list…</div>';await loadWorkflowState();let active=workflowState.waitingEntries.filter(item=>item.status==='active'),providers=data.providers.filter(item=>item.active!==false);target.innerHTML=`<div class="section-title"><div><h2>Cancellation list</h2><p>Get notified when a suitable appointment becomes available.</p></div></div><div class="grid two"><article class="card"><div class="notice">A notification does not reserve the appointment. Sign in and book the opening if it is still available.</div><div class="form-grid"><div class="field"><label>Preferred provider</label><select id="waitingProvider"><option value="">Any available provider</option>${providers.map(item=>`<option value="${item.apiId}">${escapeAccountText(item.name)}</option>`).join('')}</select></div><div class="field"><label>Location</label><select id="waitingLocation"><option value="">Any location</option>${apiLocations.map(item=>`<option value="${item.id}">${escapeAccountText(item.name)}</option>`).join('')}</select></div><div class="field"><label>From date</label><input id="waitingFrom" type="date" min="${todayStr()}" value="${todayStr()}"></div><div class="field"><label>Until date</label><input id="waitingTo" type="date" min="${todayStr()}" value="${addDate(new Date(),14).toISOString().slice(0,10)}"></div><div class="field"><label>Preferred time</label><select id="waitingTime"><option value="any">Any time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option></select></div><div class="field"><label>Notify by</label>${workflowChannels('waitingChannel',['email','sms'])}</div></div><button class="btn" style="margin-top:16px" onclick="joinWaitingList()">Join cancellation list</button></article><article class="card"><div class="card-head"><h3>My requests</h3><span class="pill">${active.length} active</span></div>${workflowState.waitingEntries.length?workflowState.waitingEntries.map(item=>`<div class="detail-row"><span><strong>${escapeAccountText(item.provider_name||'Any provider')}</strong><br><small>${escapeAccountText(item.location_name||'Any location')} · ${escapeAccountText(item.time_preference)}</small><br><small>${apiDate(item.date_from)} to ${apiDate(item.date_to)}</small></span><span>${workflowStatus(item.status)}${item.status==='active'?`<br><button class="btn secondary" style="padding:7px 9px;margin-top:7px" onclick="cancelWaitingEntry('${item.id}')">Remove</button>`:''}</span></div>`).join(''):'<div class="notice">You have no cancellation-list requests.</div>'}</article></div>`}
async function joinWaitingList(){let channels=selectedWorkflowChannels('waitingChannel');if(!channels.length)return toast('Choose Email, SMS, or both');try{await apiRequest('/waiting-list',{method:'POST',body:JSON.stringify({providerId:$('waitingProvider').value||null,locationId:$('waitingLocation').value||null,dateFrom:$('waitingFrom').value,dateTo:$('waitingTo').value,timePreference:$('waitingTime').value,channels})});await renderPatientWaitingList();toast('Added to the cancellation list')}catch(error){toast(error.message)}}
async function cancelWaitingEntry(id){if(!confirm('Remove this cancellation-list request?'))return;try{await apiRequest(`/waiting-list/${id}/cancel`,{method:'PATCH'});await renderPatientWaitingList();toast('Cancellation-list request removed')}catch(error){toast(error.message)}}

async function renderAdminWaitingList(){let target=$('adminWaitingList');target.innerHTML='<div class="notice">Loading waiting list…</div>';await loadWorkflowState();let cancelled=data.appointments.filter(item=>['Cancelled','No-show'].includes(item.status)&&item.date>=todayStr()).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));target.innerHTML=`<div class="section-title"><div><h2>Cancellation waiting list</h2><p>Choose a cancelled opening to find and notify matching patients.</p></div><button class="btn" onclick="openAdminWaitingModal()">＋ Add patient</button></div><article class="card"><div class="form-grid"><div class="field full"><label>Cancelled appointment opening</label><select id="waitingOpening"><option value="">Choose a cancelled appointment</option>${cancelled.map(item=>{let provider=data.providers.find(p=>p.id===item.providerId);return `<option value="${item.apiId}">${fmtDate(item.date)} ${item.time} · ${escapeAccountText(provider?.name||'Provider')} · ${escapeAccountText(item.location)}</option>`}).join('')}</select></div></div><button class="btn" style="margin-top:14px" onclick="loadWaitingMatches()">Find matching patients</button><div id="waitingMatches" style="margin-top:16px"></div></article><article class="card dashboard-table" style="margin-top:18px"><div class="card-head"><h3>All waiting-list requests</h3><span class="pill">${workflowState.waitingEntries.filter(item=>item.status==='active').length} active</span></div>${workflowState.waitingEntries.length?`<table><thead><tr><th>Patient</th><th>Provider</th><th>Location</th><th>Date range</th><th>Time</th><th>Channels</th><th>Status</th></tr></thead><tbody>${workflowState.waitingEntries.map(item=>`<tr><td>${escapeAccountText(item.patient_name)}</td><td>${escapeAccountText(item.provider_name||'Any provider')}</td><td>${escapeAccountText(item.location_name||'Any')}</td><td>${apiDate(item.date_from)}–${apiDate(item.date_to)}</td><td>${escapeAccountText(item.time_preference)}</td><td>${escapeAccountText((item.notification_channels||[]).join(' + '))}</td><td>${workflowStatus(item.status)}</td></tr>`).join('')}</tbody></table>`:'<div class="notice">No waiting-list requests.</div>'}</article>`}
async function loadWaitingMatches(){let appointmentId=$('waitingOpening').value,target=$('waitingMatches');if(!appointmentId)return toast('Choose a cancelled appointment');target.innerHTML='<div class="notice">Finding matches…</div>';try{let result=await apiRequest(`/waiting-list/matches/${appointmentId}`),matches=result.matches||[];target.innerHTML=matches.length?`<div class="detail-list">${matches.map(item=>`<div class="detail-row"><span><strong>${escapeAccountText(item.patient_name)}</strong><br><small>${escapeAccountText((item.notification_channels||[]).join(' + '))}</small></span><button class="btn" onclick="notifyWaitingPatient('${item.id}','${appointmentId}')">Notify</button></div>`).join('')}</div>`:'<div class="notice">No patients match this opening.</div>'}catch(error){target.innerHTML=`<div class="notice">${escapeAccountText(error.message)}</div>`}}
async function notifyWaitingPatient(entryId,appointmentId){if(!confirm('Send this cancellation opening by Email/SMS now?'))return;try{let result=await apiRequest(`/waiting-list/${entryId}/notify`,{method:'POST',body:JSON.stringify({appointmentId})}),sent=result.deliveries.filter(item=>item.status==='sent').length,failed=result.deliveries.length-sent;await renderAdminWaitingList();toast(`${sent} delivered${failed?` · ${failed} failed`:''}`)}catch(error){toast(error.message)}}
function closeAdminWaitingModal(){$('adminWaitingModal')?.remove()}
function openAdminWaitingModal(){ensureBookingModalStyles();closeAdminWaitingModal();document.body.insertAdjacentHTML('beforeend',`<div id="adminWaitingModal" class="modal-backdrop" onclick="if(event.target.id==='adminWaitingModal')closeAdminWaitingModal()"><article class="modal-card"><div class="card-head"><h3 style="margin:0">Add patient to cancellation list</h3><button class="btn secondary" onclick="closeAdminWaitingModal()">Close</button></div><div class="form-grid"><div class="field full"><label>Patient</label><select id="adminWaitingPatient">${workflowPatientOptions()}</select></div><div class="field"><label>Provider</label><select id="adminWaitingProvider"><option value="">Any provider</option>${workflowProviderOptions()}</select></div><div class="field"><label>Location</label><select id="adminWaitingLocation"><option value="">Any location</option>${apiLocations.map(item=>`<option value="${item.id}">${escapeAccountText(item.name)}</option>`).join('')}</select></div><div class="field"><label>From date</label><input id="adminWaitingFrom" type="date" min="${todayStr()}" value="${todayStr()}"></div><div class="field"><label>Until date</label><input id="adminWaitingTo" type="date" min="${todayStr()}" value="${addDate(new Date(),14).toISOString().slice(0,10)}"></div><div class="field"><label>Preferred time</label><select id="adminWaitingTime"><option value="any">Any time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option></select></div><div class="field"><label>Notify by</label>${workflowChannels('adminWaitingChannel',['email','sms'])}</div></div><div class="modal-actions"><button class="btn secondary" onclick="closeAdminWaitingModal()">Cancel</button><button class="btn" onclick="addAdminWaitingEntry()">Add patient</button></div></article></div>`)}
async function addAdminWaitingEntry(){let channels=selectedWorkflowChannels('adminWaitingChannel');if(!channels.length)return toast('Choose Email, SMS, or both');try{await apiRequest('/waiting-list',{method:'POST',body:JSON.stringify({patientId:$('adminWaitingPatient').value,providerId:$('adminWaitingProvider').value||null,locationId:$('adminWaitingLocation').value||null,dateFrom:$('adminWaitingFrom').value,dateTo:$('adminWaitingTo').value,timePreference:$('adminWaitingTime').value,channels})});closeAdminWaitingModal();await renderAdminWaitingList();toast('Patient added to cancellation list')}catch(error){toast(error.message)}}

function meetingLinkHTML(appointment){return appointment?.meetingUrl?`<div class="meeting-link-box"><strong>Online session link</strong><a href="${escapeAccountText(appointment.meetingUrl)}" target="_blank" rel="noopener">Join session</a><div class="sub">${escapeAccountText(appointment.meetingUrl)}</div></div>`:''}
function isOnlineAppointment(appointment){return String(appointment?.mode||appointment?.location||'').toLowerCase()==='online'||String(appointment?.location||'').toLowerCase()==='online'}
function meetingMessageText(appointment,provider){return appointment?.meetingUrl?`\n\nOnline session link: ${appointment.meetingUrl}`:''}
function openCommunicationForAppointment(id,role=session?.role){let appointment=data.appointments.find(item=>item.id===id),patient=appointment&&data.patients.find(item=>item.id===appointment.patientId),provider=appointment&&data.providers.find(item=>item.id===appointment.providerId);if(!appointment||!patient)return toast('Appointment contact not found');openWorkflowMessages(patient.apiId,'WannaTalk appointment reminder',`WannaTalk reminder: your appointment with ${provider?.name||'your provider'} is on ${fmtDate(appointment.date)} at ${appointment.time} (${appointment.location||appointment.mode}).${meetingMessageText(appointment,provider)}`,provider?.apiId||'',role)}
sendReminder=function(id){openCommunicationForAppointment(id)};
changeStatus=async function(id,status){let appointment=data.appointments.find(item=>item.id===id);if(!appointment)return toast('Appointment not found');try{await apiRequest(`/appointments/${appointment.apiId}/status`,{method:'PATCH',body:JSON.stringify({status})});await reloadApiData();renderDashboard();renderCalendar();toast('Appointment status updated')}catch(error){toast(error.message)}};

cancelButtonHTML=function(appointment,actor){return activeAppt(appointment)?`<button class="btn danger" style="padding:8px 10px;box-shadow:none" onclick="event.stopPropagation();cancelAppointment(${appointment.id},'${actor}')">Cancel appointment</button>`:''};

cancelAppointment=async function(id,actor=session?.role||'admin'){
  let appointment=data.appointments.find(item=>item.id===id);if(!appointment)return toast('Appointment not found');
  if(!activeAppt(appointment))return toast('This appointment is already closed');
  if(!confirm(`Cancel this appointment for ${fmtDate(appointment.date)} at ${appointment.time}?`))return;
  try{
    await apiRequest(`/appointments/${appointment.apiId}/status`,{method:'PATCH',body:JSON.stringify({status:'Cancelled'})});
    closeBookingModal();await reloadApiData();refreshAppointmentViews();if(session?.role==='admin')renderAuditLog();toast('Appointment cancelled and saved');
  }catch(error){toast(error.message)}
};

const legacyRenderAdminAppointments=renderAdminAppointments;
renderAdminAppointments=function(){
  if(!$('adminAppointmentTable'))return legacyRenderAdminAppointments();
  if($('adminStatusFilter')&&!$('adminAppointmentSort'))$('adminStatusFilter').insertAdjacentHTML('afterend','<select id="adminAppointmentSort" onchange="renderAdminAppointments()"><option value="soonest">Sort: soonest first</option><option value="latest">Sort: latest first</option></select>');
  let queryText=($('adminSearch')?.value||'').toLowerCase(),providerId=Number($('adminProviderFilter')?.value||0),status=$('adminStatusFilter')?.value||'',sortOrder=$('adminAppointmentSort')?.value||'soonest';
  let appointments=[...data.appointments].sort((left,right)=>sortOrder==='latest'?(right.date+right.time).localeCompare(left.date+left.time):(left.date+left.time).localeCompare(right.date+right.time)).filter(appointment=>{let patient=data.patients.find(item=>item.id===appointment.patientId),provider=data.providers.find(item=>item.id===appointment.providerId),haystack=`${patient?.name||''} ${provider?.name||''} ${appointment.type} ${appointment.mode}`.toLowerCase();return(!queryText||haystack.includes(queryText))&&(!providerId||appointment.providerId===providerId)&&(!status||appointment.status===status)});
  $('adminAppointmentTable').innerHTML=`<div class="template-note" style="margin:0 0 12px">${sortOrder==='latest'?'Latest date first':'Soonest date first'} · ${appointments.length} appointment${appointments.length===1?'':'s'} showing</div>${adminAppointmentRows(appointments,true)}`;
};

const legacyRenderDashboard=renderDashboard;
renderDashboard=function(){legacyRenderDashboard();document.querySelectorAll('#todayAppointments .wa-btn').forEach(button=>{let match=String(button.getAttribute('onclick')||'').match(/sendReminder\((\d+)\)/);if(!match)return;let id=Number(match[1]);button.className='btn secondary';button.style.display='inline-flex';button.style.padding='8px 10px';button.textContent='Email / SMS';button.onclick=event=>{event.stopPropagation();openCommunicationForAppointment(id)}});document.querySelectorAll('#todayOverview button').forEach(button=>{if(button.textContent.includes('WhatsApp')){button.textContent='Send Email / SMS';button.onclick=()=>showP('messages')}})};
renderProviderPatients=function(){let ids=[...new Set(providerAppointments().map(item=>item.patientId))],rows=ids.map(id=>{let patient=data.patients.find(item=>item.id===id),appointments=providerAppointments().filter(item=>item.patientId===id),latest=[...appointments].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))[0];return `<tr><td><span class="patient-name">${escapeAccountText(patient?.name||'')}</span><div class="sub">${escapeAccountText(patient?.email||'')}</div></td><td>${escapeAccountText(patient?.mobile||'No mobile')}</td><td>${appointments.length}</td><td>${latest?fmtDate(latest.date):'—'}</td><td><div class="workflow-row-actions"><button class="btn secondary" style="padding:8px 10px" onclick="openWorkflowMessages('${patient?.apiId}')">Email / SMS</button><button class="btn secondary" style="padding:8px 10px" onclick="openFollowUpModal('${patient?.apiId}','${currentProvider()?.apiId}')">Follow-up</button></div></td></tr>`}).join('');$('providerPatients').innerHTML=rows?`<table><thead><tr><th>Patient</th><th>Mobile</th><th>Appointments</th><th>Latest booking</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="notice">No patients have booked with you yet.</div>'};

const legacyOpenBooking=openBooking;
openBooking=function(id,actor){legacyOpenBooking(id,actor);let modal=$('bookingModal'),appointment=data.appointments.find(item=>item.id===id),patient=appointment&&data.patients.find(item=>item.id===appointment.patientId),provider=appointment&&data.providers.find(item=>item.id===appointment.providerId);modal?.querySelectorAll('.wa-btn').forEach(item=>item.remove());if(modal&&actor!=='patient'&&patient){let actions=modal.querySelector('.modal-actions');actions?.insertAdjacentHTML('beforeend',`<button class="btn secondary" onclick="closeBookingModal();openWorkflowMessages('${patient.apiId}','Message from WannaTalk','','${provider?.apiId||''}','${actor}')">Email / SMS</button><button class="btn secondary" onclick="closeBookingModal();openFollowUpModal('${patient.apiId}','${provider?.apiId||''}')">Follow-up</button>`)}};

const workflowBookingWithMessages=openBooking;
openBooking=function(id,actor){
  workflowBookingWithMessages(id,actor);
  let modal=$('bookingModal'),appointment=data.appointments.find(item=>item.id===id);
  if(!modal||!appointment)return;
  let grid=modal.querySelector('.booking-detail-grid'),actions=modal.querySelector('.modal-actions');
  let closeButton=modal.querySelector('.card-head .btn.secondary');
  if(closeButton)closeButton.textContent='Close booking';
  if(isOnlineAppointment(appointment)&&!modal.querySelector('.online-pill'))grid?.insertAdjacentHTML('beforeend',`<div class="detail-row"><span>Online status</span><strong><span class="online-pill">Online session</span></strong></div>`);
  if(appointment.meetingUrl&&!modal.querySelector('.meeting-link-box')){
    grid?.insertAdjacentHTML('afterend',meetingLinkHTML(appointment));
    actions?.insertAdjacentHTML('afterbegin',`<a class="btn" href="${escapeAccountText(appointment.meetingUrl)}" target="_blank" rel="noopener">Join session</a>`);
  }
  actions?.insertAdjacentHTML('beforeend','<button class="btn secondary" onclick="closeBookingModal()">Close</button>');
};

function appointmentMeetingBadge(appointment){return appointment?.meetingUrl?'<div class="online-pill">Online link ready</div>':isOnlineAppointment(appointment)?'<div class="online-pill">Online session</div>':''}
const workflowAdminAppointmentRows=adminAppointmentRows;
adminAppointmentRows=function(apps,editable=true){
  if(!apps.length)return '<div class="empty">No appointments match this view.</div>';
  return `<table><thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Provider</th><th>Type / location</th><th>Status</th><th>Actions</th></tr></thead><tbody>${apps.map(appointment=>{let patient=data.patients.find(item=>item.id===appointment.patientId),provider=data.providers.find(item=>item.id===appointment.providerId);return `<tr ondblclick="openBooking(${appointment.id},'admin')" title="Double-click to view booking"><td>${fmtDate(appointment.date)}</td><td><strong>${appointment.time}</strong></td><td><span class="patient-name">${escapeAccountText(patient?.name||'Patient')}</span><div class="sub">${escapeAccountText(patient?.mobile||patient?.email||'')}</div></td><td><span class="patient-name">${escapeAccountText(provider?.name||'Provider')}</span><div class="sub">${escapeAccountText(provider?.role||'')}</div></td><td>${escapeAccountText(appointment.type)}<div class="sub">Location: ${escapeAccountText(appointment.location||appointment.mode)}</div>${appointment.intakeRequested?'<div class="intake-badge">Intake selected</div>':''}${appointmentMeetingBadge(appointment)}</td><td>${editable?`<select onchange="adminChangeStatus(${appointment.id},this.value)">${['Booked','Confirmed','Arrived','Completed','Cancelled','No-show'].map(status=>`<option ${status===appointment.status?'selected':''}>${status}</option>`).join('')}</select>`:`<span class="status ${statusKey(appointment.status)}">${escapeAccountText(appointment.status)}</span>`}</td><td><div class="workflow-row-actions"><button class="btn secondary" style="padding:8px 10px;box-shadow:none" onclick="event.stopPropagation();openBooking(${appointment.id},'admin')">View</button>${appointment.meetingUrl?`<a class="btn secondary" style="padding:8px 10px;box-shadow:none" href="${escapeAccountText(appointment.meetingUrl)}" target="_blank" rel="noopener">Join</a>`:''}${rescheduleButtonHTML(appointment,'admin')}${cancelButtonHTML(appointment,'admin')}${deleteButtonHTML(appointment,'admin')}</div></td></tr>`}).join('')}</tbody></table>`;
};

function adminBookingTimeSlots(provider,date){
  if(!provider||!date)return [];
  let availability=provider.availability?.[new Date(`${date}T00:00:00`).getDay()],duration=Number(provider.duration||60);
  if(!availability?.on)return [];
  let slots=[];
  for(let minute=timeToMin(availability.start);minute+duration<=timeToMin(availability.end);minute+=60){
    let time=minToTime(minute),end=minute+duration,past=bookingDateTimeInPast(date,time),blocked=(provider.blocks||[]).some(block=>block.date===date&&minute<timeToMin(block.end)&&end>timeToMin(block.start)),taken=data.appointments.some(appointment=>appointment.providerId===provider.id&&appointment.date===date&&!['Cancelled','No-show'].includes(appointment.status)&&minute<timeToMin(appointment.time)+Number(appointment.duration||60)&&end>timeToMin(appointment.time));
    if(!past&&!blocked&&!taken)slots.push(time);
  }
  return slots;
}
function updateAdminBookingSlots(){
  let provider=data.providers.find(item=>item.apiId===$('adminBookingProvider')?.value),date=$('adminBookingDate')?.value,select=$('adminBookingTime');if(!select)return;
  let slots=adminBookingTimeSlots(provider,date);
  select.innerHTML=slots.length?slots.map(time=>`<option value="${time}">${time}</option>`).join(''):'<option value="">No available slots</option>';
}
const workflowUpdateAdminBookingLocations=updateAdminBookingLocations;
updateAdminBookingLocations=function(){
  workflowUpdateAdminBookingLocations();
  let location=apiLocations.find(item=>item.id===$('adminBookingLocation')?.value),mode=$('adminBookingMode');
  if(mode&&location?.name==='Online')mode.value='Online';
  updateAdminBookingSlots();
};
const workflowOpenAdminBookingCreator=openAdminBookingCreator;
openAdminBookingCreator=function(){
  workflowOpenAdminBookingCreator();
  let time=$('adminBookingTime'),date=$('adminBookingDate'),provider=$('adminBookingProvider'),location=$('adminBookingLocation'),mode=$('adminBookingMode');
  if(time&&time.tagName!=='SELECT')time.outerHTML='<select id="adminBookingTime"></select>';
  if(date)date.onchange=updateAdminBookingSlots;
  if(provider)provider.onchange=updateAdminBookingLocations;
  if(location)location.onchange=()=>{let selected=apiLocations.find(item=>item.id===$('adminBookingLocation')?.value);if(mode&&selected?.name==='Online')mode.value='Online';updateAdminBookingSlots()};
  if(mode)mode.onchange=updateAdminBookingSlots;
  updateAdminBookingSlots();
};

function patientProviderSlotTimes(providers,week){
  let values=new Set();
  week.forEach(dateValue=>{
    let dayOfWeek=dateValue.getDay();
    providers.forEach(provider=>{
      let availability=provider.availability?.[dayOfWeek],duration=Number(provider.duration||60);
      if(!availability?.on)return;
      for(let minute=timeToMin(availability.start);minute+duration<=timeToMin(availability.end);minute+=duration)values.add(minToTime(minute));
    });
  });
  return [...values].sort((left,right)=>timeToMin(left)-timeToMin(right));
}
function providerSlotState(provider,date,time){
  let duration=Number(provider.duration||60),startMinute=timeToMin(time),endMinute=startMinute+duration;
  let blocked=(provider.blocks||[]).some(block=>block.date===date&&timeToMin(block.start)<endMinute&&timeToMin(block.end)>startMinute);
  let busy=(provider.busy||[]).some(item=>item.date===date&&timeToMin(item.start)<endMinute&&timeToMin(item.end)>startMinute);
  let localConflict=data.appointments.some(appointment=>appointment.providerId===provider.id&&appointment.date===date&&!['Cancelled','No-show'].includes(appointment.status)&&timeToMin(appointment.time)<endMinute&&timeToMin(appointment.time)+Number(appointment.duration||60)>startMinute);
  return {blocked,busy:busy||localConflict,past:bookingDateTimeInPast(date,time)};
}
function patientSlotMatchesForDateTime(providers,date,time){
  let dayOfWeek=dtFromISO(date).getDay();
  return providers.map(provider=>{
    let availability=provider.availability?.[dayOfWeek],duration=Number(provider.duration||60),startMinute=timeToMin(time),endMinute=startMinute+duration;
    let fits=availability?.on&&startMinute>=timeToMin(availability.start)&&endMinute<=timeToMin(availability.end);
    if(!fits)return null;
    return {provider,duration,...providerSlotState(provider,date,time)};
  }).filter(Boolean);
}
function patientSlotButton(item,date,time,compact=false){
  let end=minToTime(timeToMin(time)+item.duration),selected=selectedProvider===item.provider.id&&selectedTime===time&&$('bookDate')?.value===date;
  let unavailable=item.busy||item.blocked,cssClass=item.past?'past':unavailable?'unavailable':selected?'booked':'available';
  let label=item.past?'Past time':unavailable?'Not available':selected?'Selected':'Available';
  let attrs=item.past||unavailable?'disabled':`onclick="selectCalendarSlot('${date}',${item.provider.id},'${time}')"`;
  if(compact)return `<button class="month-event calendar-booking ${cssClass}" ${attrs}><strong>${time}</strong> ${escapeAccountText(item.provider.name)}<br><small>${label} · ${escapeAccountText(selectedLocation)}</small></button>`;
  return `<button class="week-event ${cssClass}" ${attrs}><span class="event-time">${time} - ${end}</span><span class="event-label">${escapeAccountText(item.provider.name)}</span><small class="event-meta">${label} · ${escapeAccountText(selectedLocation)}${providerOnline(item.provider)?'':' · Provider offline'}</small></button>`;
}
function patientBookableWeekHTML(providers,base){
  let weekStart=startWeek(dtFromISO(base)),week=Array.from({length:5},(_,index)=>addDate(weekStart,index)),times=patientProviderSlotTimes(providers,week);
  if(!times.length)return '<div class="notice">No provider availability is configured for this week.</div>';
  let heads='<div class="week-cell week-head"></div>'+week.map(date=>`<div class="week-cell week-head">${date.toLocaleDateString('en-ZA',{weekday:'short'})}<br>${date.getDate()} ${date.toLocaleDateString('en-ZA',{month:'short'})}</div>`).join('');
  let rows=times.map(time=>`<div class="week-cell week-time">${time}</div>`+week.map(date=>{
    let iso=isoDate(date),matches=patientSlotMatchesForDateTime(providers,iso,time);
    if(!matches.length)return `<div class="week-cell">${bookingDateTimeInPast(iso,'23:59')?'<div class="notice booking-date-warning" style="margin:0">Past date</div>':''}</div>`;
    return `<div class="week-cell">${matches.slice(0,4).map(item=>patientSlotButton(item,iso,time)).join('')}</div>`;
  }).join('')).join('');
  return `<div class="week-shell reference-calendar"><div class="week-board">${heads}${rows}</div></div>`;
}
function patientBookableDayHTML(providers,base){
  let date=isoDate(dtFromISO(base)),times=patientProviderSlotTimes(providers,[dtFromISO(base)]);
  if(!times.length)return '<div class="notice">No provider availability is configured for this day.</div>';
  let head=`<div class="week-cell week-head"></div><div class="week-cell week-head">${dtFromISO(base).toLocaleDateString('en-ZA',{weekday:'short'})}<br>${dtFromISO(base).getDate()} ${dtFromISO(base).toLocaleDateString('en-ZA',{month:'short'})}</div>`;
  let rows=times.map(time=>`<div class="week-cell week-time">${time}</div><div class="week-cell">${patientSlotMatchesForDateTime(providers,date,time).slice(0,6).map(item=>patientSlotButton(item,date,time)).join('')||'<div class="notice">No slot at this time.</div>'}</div>`).join('');
  return `<div class="week-shell reference-calendar day-shell"><div class="week-board">${head}${rows}</div></div>`;
}
function patientBookableMonthHTML(providers,base){
  let baseDate=dtFromISO(base),first=new Date(baseDate.getFullYear(),baseDate.getMonth(),1),start=new Date(first),monthTitle=baseDate.toLocaleDateString('en-ZA',{month:'long',year:'numeric'});
  start.setDate(first.getDate()-((first.getDay()+6)%7));
  let labels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],heads=labels.map(day=>`<div class="month-head">${day}</div>`).join('');
  let cells=Array.from({length:42},(_,index)=>{
    let date=addDate(start,index),iso=isoDate(date),muted=date.getMonth()!==baseDate.getMonth(),times=patientProviderSlotTimes(providers,[date]);
    let slotButtons=[],availableCount=0,unavailableCount=0;
    for(let time of times){
      let matches=patientSlotMatchesForDateTime(providers,iso,time);
      let preferred=matches.find(item=>!item.past&&!item.busy&&!item.blocked)||matches.find(item=>item.busy||item.blocked)||matches[0];
      if(!preferred)continue;
      if(preferred.busy||preferred.blocked||preferred.past)unavailableCount+=1;else availableCount+=1;
      if(slotButtons.length<4)slotButtons.push(patientSlotButton(preferred,iso,time,true));
    }
    let countLabel=availableCount||unavailableCount?`<span class="count">${availableCount} available · ${unavailableCount} unavailable</span>`:'';
    return `<div class="month-day ${muted?'muted':''}"><div class="month-date"><span>${date.getDate()}</span>${countLabel}</div>${slotButtons.join('')||(!muted&&bookingDateTimeInPast(iso,'23:59')?'<div class="notice booking-date-warning" style="margin:0">Past date</div>':'')}</div>`;
  }).join('');
  return `<div class="month-shell"><div class="month-board"><div class="month-title">${monthTitle}</div>${heads}${cells}</div></div>`;
}
function patientBookableCalendarHTML(providers,base=calendarBase()){
  if(calendarViewMode==='month')return patientBookableMonthHTML(providers,base);
  if(calendarViewMode==='day')return patientBookableDayHTML(providers,base);
  return patientBookableWeekHTML(providers,base);
}
patientWeekSlotsHTML=function(){
  if(!selectedLocation)return '<div class="notice">Choose Centurion, Emalahleni or Online to see the weekly time slots.</div>';
  let base=calendarBase();
  let providers=data.providers.filter(provider=>(provider.locations||['Online']).includes(selectedLocation)&&(!selectedProvider||provider.id===selectedProvider));
  if(!providers.length)return `${calendarControlsHTML('Weekly time-slot view','No provider offers this location yet.',base)}<div class="notice">No providers are available for ${escapeAccountText(selectedLocation)}.</div>`;
  let busyCount=providers.reduce((total,provider)=>total+(provider.busy||[]).length+(provider.blocks||[]).length,0);
  return `${calendarControlsHTML('Calendar view','Choose an available green slot. The layout now matches the admin calendar.',base)}<div class="template-note" style="margin:-10px 0 12px">${calendarModeLabel()} · ${busyCount} DB booked/blocked time${busyCount===1?'':'s'} loaded · grey slots are not available</div>${patientBookableCalendarHTML(providers,base)}`;
};
const workflowUpdateBookingSummary=updateBookingSummary;
updateBookingSummary=function(){
  workflowUpdateBookingSummary();
  if(!selectedLocation||!selectedProvider||!selectedTime||!$('bookDate')?.value)return;
  let provider=data.providers.find(item=>item.id===selectedProvider),state=provider&&providerSlotState(provider,$('bookDate').value,selectedTime);
  if(state&&(state.busy||state.blocked||state.past))$('bookingSummary').innerHTML='<span class="booking-date-warning">This slot is no longer available. Please choose another green slot.</span>';
};

savePatientProfile=async function(){let patient=currentPatient(),preferredContact=$('upContact').value;try{await apiRequest('/patients/me',{method:'PATCH',body:JSON.stringify({fullName:$('upName').value.trim(),mobile:$('upMobile').value.trim(),preferredContact})});await reloadApiData();renderPatient();toast('Profile saved')}catch(error){toast(error.message)}};

const legacyLoadPatientProfile=loadPatientProfile;
loadPatientProfile=function(){legacyLoadPatientProfile();setContactOptions($('upContact'));let patient=currentPatient();$('upContact').value=['WhatsApp','Phone'].includes(patient.contact)?'SMS':patient.contact||'Email'};

setupWorkflowUI();
