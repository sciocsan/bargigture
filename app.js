(() => {
  "use strict";
  const DB_NAME = "bargig-rute-db";
  const STORE = "visits";
  const STATUSES = ["De contactat", "Programat", "Vizitat", "Interesat", "Follow-up", "Client", "Nu este interesat", "De reverificat"];
  const WEBSITE_STATUSES = ["Website oficial confirmat", "Website confirmat; locație de reverificat", "Doar social media / platformă", "Website oficial neconfirmat", "Nu am găsit website oficial"];
  const $ = id => document.getElementById(id);
  const state = { visits: [], view: "agenda", editing: null, pendingPhotos: [] };
  let toastTimer;

  const localDate = date => {
    const d = date ? new Date(`${date}T12:00:00`) : new Date();
    return d.toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };
  const today = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const normalizeInputDate = value => {
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const ro = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    return ro ? `${ro[3]}-${ro[2].padStart(2, "0")}-${ro[1].padStart(2, "0")}` : "";
  };
  const showToast = message => { clearTimeout(toastTimer); $("toast").textContent = message; $("toast").classList.add("show"); toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2400); };

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function allVisits() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveVisit(visit) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(visit);
      req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    });
  }
  async function removeVisit(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
      req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    });
  }

  async function seedIfNeeded() {
    const existing = await allVisits();
    if (existing.length || !Array.isArray(window.BARGIG_SEED)) return;
    await Promise.all(window.BARGIG_SEED.map(saveVisit));
  }
  async function migrateWebsiteData() {
    if (!Array.isArray(window.BARGIG_SEED)) return;
    const websiteFields = ["websiteStatus","websitePresence","websiteUrl","websiteSource","websiteCheckedAt","websiteAudit","websiteImprovement","websiteOperationalNote","websitePriority","contactPriority","barGigScore","websiteOpportunity","websiteDataVersion"];
    const seedById = new Map(window.BARGIG_SEED.map(v => [v.id, v]));
    const seedByName = new Map(window.BARGIG_SEED.map(v => [`${v.name}|${v.city}`.toLowerCase(), v]));
    for (const visit of await allVisits()) {
      const source = seedById.get(visit.id) || seedByName.get(`${visit.name}|${visit.city}`.toLowerCase());
      if (!source) continue;
      const version = visit.websiteDataVersion || 0;
      if (version >= 2) continue;
      if (version < 1) {
        const websiteData = Object.fromEntries(websiteFields.map(field => [field, source[field] ?? ""]));
        websiteData.websiteCheckedAt = normalizeInputDate(source.websiteCheckedAt);
        websiteData.websiteDataVersion = 2;
        await saveVisit({ ...visit, ...websiteData });
      } else {
        await saveVisit({
          ...visit,
          websiteCheckedAt: normalizeInputDate(visit.websiteCheckedAt || source.websiteCheckedAt),
          websiteDataVersion: 2
        });
      }
    }
  }
  async function refresh() {
    state.visits = (await allVisits()).sort((a, b) => `${a.date}${a.time || ""}${a.order || 0}`.localeCompare(`${b.date}${b.time || ""}${b.order || 0}`));
    populateFilters();
    renderAll();
  }

  function populateFilters() {
    const cities = [...new Set(state.visits.map(v => v.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ro"));
    const currentCity = $("cityFilter").value;
    $("cityFilter").innerHTML = `<option value="">Toate</option>${cities.map(c => `<option>${esc(c)}</option>`).join("")}`;
    $("cityFilter").value = currentCity;
    const currentStatus = $("statusFilter").value;
    $("statusFilter").innerHTML = `<option value="">Toate</option>${STATUSES.map(s => `<option>${esc(s)}</option>`).join("")}`;
    $("statusFilter").value = currentStatus;
    $("status").innerHTML = STATUSES.map(s => `<option>${esc(s)}</option>`).join("");
    const websiteStatus = $("websiteStatus").value;
    $("websiteStatus").innerHTML = WEBSITE_STATUSES.map(s => `<option>${esc(s)}</option>`).join("");
    $("websiteStatus").value = websiteStatus || "Website oficial neconfirmat";
  }

  function statusClass(status) {
    if (["Vizitat","Client"].includes(status)) return "done";
    if (["Interesat","Follow-up"].includes(status)) return "hot";
    if (status === "Nu este interesat") return "lost";
    return "";
  }
  function offerChips(v) {
    return [v.offers?.shifts && "Ture", v.offers?.events && "Evenimente", v.offers?.hosting && "WebSpace"].filter(Boolean);
  }
  function websiteInfo(v) {
    const status = v.websiteStatus || "Website oficial neconfirmat";
    if (status === "Website oficial confirmat") return ["Website confirmat", "site-ok"];
    if (status.includes("reverificat")) return ["Website de reverificat", "site-warn"];
    if (status.startsWith("Doar social")) return ["Doar social / platformă", "site-social"];
    if (status.startsWith("Nu am găsit")) return ["Fără website găsit", "site-missing"];
    return ["Website neconfirmat", "site-warn"];
  }
  function websiteChip(v) { const [label, cls] = websiteInfo(v); return `<span class="chip website-chip ${cls}">${esc(label)}</span>`; }
  function renderStats() {
    const t = today();
    const day = state.visits.filter(v => v.date === t);
    const visited = state.visits.filter(v => ["Vizitat","Interesat","Follow-up","Client","Nu este interesat"].includes(v.status)).length;
    const hot = state.visits.filter(v => ["Interesat","Follow-up"].includes(v.status)).length;
    const follow = state.visits.filter(v => v.followUp && v.followUp <= t && !["Client","Nu este interesat"].includes(v.status)).length;
    $("stats").innerHTML = [
      ["Vizite astăzi", day.length, day.length ? `${day.filter(v=>v.status==="Vizitat").length} încheiate` : "Planifică ziua"],
      ["Vizitate total", visited, `${Math.round(visited / Math.max(state.visits.length,1)*100)}% din listă`],
      ["Lead-uri calde", hot, "Interes / follow-up"],
      ["Follow-up scadent", follow, follow ? "Necesită acțiune" : "Totul la zi"]
    ].map(([label,value,note]) => `<article class="stat"><span>${label}</span><strong>${value}</strong><em>${note}</em></article>`).join("");
  }
  function renderAgenda() {
    const date = $("dateFilter").value || today();
    const search = $("searchInput").value.trim().toLowerCase();
    const city = $("cityFilter").value;
    const visits = state.visits.filter(v => v.date === date && (!city || v.city === city) && (!search || [v.name,v.city,v.address,v.notes,v.decisionMaker,v.websiteStatus,v.websiteAudit,v.websiteImprovement].join(" ").toLowerCase().includes(search)));
    $("daySummary").innerHTML = `<b>${esc(localDate(date))}</b><span>•</span><span>${visits.length} opriri</span><span>•</span><span>${visits.filter(v=>v.status==="Vizitat").length} vizitate</span>`;
    $("visitList").innerHTML = visits.map(v => {
      const chips = offerChips(v);
      return `<article class="visit-card" style="--accent:${v.priority === "P1" ? "#ff6b6b" : v.priority === "P3" ? "#25c7a5" : "#f6b73c"}">
        <div class="visit-time">${esc(v.time || "—")}</div>
        <div class="visit-main"><h3>${esc(v.name)}</h3><p>${esc(v.address)}${v.city ? ` · ${esc(v.city)}` : ""}</p><div class="chips">${chips.map(c=>`<span class="chip">${c}</span>`).join("")}${websiteChip(v)}${v.photos?.length ? `<span class="chip">📷 ${v.photos.length}</span>` : ""}</div></div>
        <div class="visit-meta"><span class="status ${statusClass(v.status)}">${esc(v.status)}</span><p>${v.decisionMaker ? `Decident: ${esc(v.decisionMaker)}` : esc(v.type || "Locație HoReCa")}</p>${v.followUp ? `<p>Follow-up: ${esc(v.followUp.split("-").reverse().join("."))}</p>` : ""}</div>
        <div class="card-actions"><button data-map="${esc(v.id)}" title="Hartă">⌖</button><button data-edit="${esc(v.id)}" title="Deschide">Editează</button></div>
      </article>`;
    }).join("");
    $("emptyAgenda").classList.toggle("hidden", visits.length > 0);
  }
  function renderPipeline() {
    const q = $("pipelineSearch").value.trim().toLowerCase();
    const status = $("statusFilter").value;
    const visits = state.visits.filter(v => (!status || v.status === status) && (!q || [v.name,v.city,v.address,v.notes,v.decisionMaker,v.websiteStatus,v.websiteAudit,v.websiteImprovement].join(" ").toLowerCase().includes(q)));
    $("pipelineGrid").innerHTML = visits.map(v => `<article class="pipeline-card"><div><span class="status ${statusClass(v.status)}">${esc(v.status)}</span></div><h3>${esc(v.name)}</h3><p class="muted">${esc(v.city)} · ${esc(v.type || "HoReCa")}</p><div class="line"><span>Vizită</span><b>${esc(v.date.split("-").reverse().join("."))} ${esc(v.time || "")}</b></div><div class="line"><span>Decident</span><b>${esc(v.decisionMaker || "—")}</b></div><div class="line"><span>Website</span><b>${esc(websiteInfo(v)[0])}</b></div><div class="line"><span>Follow-up</span><b>${esc(v.followUp ? v.followUp.split("-").reverse().join(".") : "—")}</b></div><div class="chips">${offerChips(v).map(c=>`<span class="chip">${c}</span>`).join("")}${websiteChip(v)}</div><button class="secondary" data-edit="${esc(v.id)}">Deschide fișa</button></article>`).join("") || `<div class="empty"><h2>Niciun rezultat</h2><p>Schimbă filtrul sau căutarea.</p></div>`;
  }
  function renderInsights() {
    const total = state.visits.length || 1;
    const visited = state.visits.filter(v => ["Vizitat","Interesat","Follow-up","Client","Nu este interesat"].includes(v.status)).length;
    const clients = state.visits.filter(v => v.status === "Client").length;
    const withNotes = state.visits.filter(v => v.notes?.trim()).length;
    const confirmedWebsites = state.visits.filter(v => v.websiteStatus === "Website oficial confirmat").length;
    const cards = [
      ["Acoperire vizite", visited, total, `${visited} din ${state.visits.length}`],
      ["Conversie în clienți", clients, Math.max(visited,1), `${clients} clienți`],
      ["Fișe documentate", withNotes, total, `${withNotes} cu comentarii`],
      ["Website confirmat", confirmedWebsites, total, `${confirmedWebsites} din ${state.visits.length}`]
    ];
    $("insightGrid").innerHTML = cards.map(([label,value,max,note]) => `<article class="insight"><p class="eyebrow">${label}</p><strong>${Math.round(value/max*100)}%</strong><p class="muted">${note}</p><div class="bar"><i style="width:${Math.min(100,value/max*100)}%"></i></div></article>`).join("");
    const offers = [["Ture BarGig","shifts"],["Evenimente","events"],["WebSpace","hosting"]];
    const max = Math.max(1,...offers.map(([,key])=>state.visits.filter(v=>v.offers?.[key]).length));
    $("offerBreakdown").innerHTML = offers.map(([label,key]) => { const count=state.visits.filter(v=>v.offers?.[key]).length; return `<div class="offer-row"><span>${label}</span><div class="track"><i style="width:${count/max*100}%"></i></div><b>${count}</b></div>`; }).join("");
  }
  function renderAll(){ renderStats(); renderAgenda(); renderPipeline(); renderInsights(); }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===view));
    document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===`${view}View`));
  }
  function resetForm(date = $("dateFilter").value || today()) {
    state.editing = null; state.pendingPhotos = [];
    $("visitForm").reset(); $("visitId").value=""; $("visitDate").value=date; $("status").value="De contactat"; $("priority").value="P2"; $("websiteStatus").value="Website oficial neconfirmat";
    $("dialogEyebrow").textContent="VIZITĂ NOUĂ"; $("dialogTitle").textContent="Adaugă vizită"; $("deleteVisit").classList.add("hidden"); renderPhotos(); updateWebsiteLink();
  }
  function openVisit(id) {
    const v = state.visits.find(x=>x.id===id); if(!v) return;
    state.editing=v; state.pendingPhotos=[...(v.photos||[])];
    const fields={visitId:v.id,name:v.name,city:v.city,type:v.type,address:v.address,visitDate:v.date,visitTime:v.time,phone:v.phone,status:v.status,decisionMaker:v.decisionMaker,decisionRole:v.decisionRole,followUp:v.followUp,priority:v.priority,notes:v.notes,pitch:v.pitch,websiteStatus:v.websiteStatus,websitePresence:v.websitePresence,websiteUrl:v.websiteUrl,websiteSource:v.websiteSource,websiteCheckedAt:v.websiteCheckedAt,websiteAudit:v.websiteAudit,websiteImprovement:v.websiteImprovement,websiteOperationalNote:v.websiteOperationalNote,websitePriority:v.websitePriority,websiteOpportunity:v.websiteOpportunity};
    Object.entries(fields).forEach(([id,value])=>$(id).value=value||"");
    $("offerShifts").checked=!!v.offers?.shifts; $("offerEvents").checked=!!v.offers?.events; $("offerHosting").checked=!!v.offers?.hosting;
    $("dialogEyebrow").textContent="FIȘĂ LOCAȚIE"; $("dialogTitle").textContent=v.name; $("deleteVisit").classList.remove("hidden"); renderPhotos(); updateWebsiteLink(); $("visitDialog").showModal();
  }
  function updateWebsiteLink() {
    const url = $("websiteUrl").value.trim();
    const valid = /^https?:\/\//i.test(url);
    $("websiteOpen").classList.toggle("hidden", !valid);
    $("websiteOpen").href = valid ? url : "#";
    const checked = $("websiteCheckedAt").value;
    $("websiteCheckedLabel").textContent = checked ? `Verificat la ${checked.split("-").reverse().join(".")}` : "Data verificării nu este completată";
  }
  function renderPhotos(){ $("photoGallery").innerHTML=state.pendingPhotos.map((src,i)=>`<div class="photo"><img src="${src}" alt="Fotografie vizită"><button type="button" data-photo="${i}" aria-label="Șterge fotografia">×</button></div>`).join(""); }
  async function resizeImage(file) {
    const data = await new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });
    const img = await new Promise((resolve,reject)=>{ const i=new Image(); i.onload=()=>resolve(i); i.onerror=reject; i.src=data; });
    const max=1600, scale=Math.min(1,max/Math.max(img.width,img.height)); const canvas=document.createElement("canvas"); canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale); canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height); return canvas.toDataURL("image/jpeg",.78);
  }
  function mapVisit(v){ const query=[v.name,v.address,v.city].filter(Boolean).join(", "); window.open(`https://maps.apple.com/?q=${encodeURIComponent(query)}`,"_blank","noopener"); }

  async function submitVisit(event) {
    event.preventDefault();
    const existing=state.editing||{};
    const visit={...existing,id:$("visitId").value||uid(),name:$("name").value.trim(),city:$("city").value.trim(),type:$("type").value.trim(),address:$("address").value.trim(),date:$("visitDate").value,time:$("visitTime").value,phone:$("phone").value.trim(),status:$("status").value,decisionMaker:$("decisionMaker").value.trim(),decisionRole:$("decisionRole").value.trim(),followUp:$("followUp").value,priority:$("priority").value,notes:$("notes").value.trim(),pitch:$("pitch").value.trim(),websiteStatus:$("websiteStatus").value,websitePresence:$("websitePresence").value.trim(),websiteUrl:$("websiteUrl").value.trim(),websiteSource:$("websiteSource").value.trim(),websiteCheckedAt:$("websiteCheckedAt").value,websiteAudit:$("websiteAudit").value.trim(),websiteImprovement:$("websiteImprovement").value.trim(),websiteOperationalNote:$("websiteOperationalNote").value.trim(),websitePriority:$("websitePriority").value.trim(),websiteOpportunity:$("websiteOpportunity").value.trim(),websiteDataVersion:1,offers:{shifts:$("offerShifts").checked,events:$("offerEvents").checked,hosting:$("offerHosting").checked},photos:state.pendingPhotos,updatedAt:new Date().toISOString()};
    await saveVisit(visit); $("visitDialog").close(); $("dateFilter").value=visit.date; await refresh(); showToast("Vizita a fost salvată");
  }
  function download(content,name,type){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }
  function exportJson(){ download(JSON.stringify({app:"BarGig Rute",version:1,exportedAt:new Date().toISOString(),visits:state.visits},null,2),`BarGig-Rute-backup-${today()}.json`,"application/json"); showToast("Backup exportat"); }
  function exportCsv(){ const keys=["date","time","city","name","address","type","status","priority","decisionMaker","decisionRole","followUp","phone","websiteStatus","websitePresence","websiteUrl","websiteCheckedAt","websiteAudit","websiteImprovement","websiteOpportunity","websitePriority","notes","pitch"]; const q=v=>`"${String(v??"").replaceAll('"','""')}"`; const rows=[keys.join(","),...state.visits.map(v=>keys.map(k=>q(v[k])).join(","))]; download("\ufeff"+rows.join("\r\n"),`BarGig-Rute-${today()}.csv`,"text/csv;charset=utf-8"); showToast("CSV exportat"); }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>setView(t.dataset.view)));
    ["searchInput","cityFilter","dateFilter"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",renderAgenda));
    ["pipelineSearch","statusFilter"].forEach(id=>$(id).addEventListener(id==="pipelineSearch"?"input":"change",renderPipeline));
    document.addEventListener("click",e=>{ const edit=e.target.closest("[data-edit]"); const map=e.target.closest("[data-map]"); if(edit) openVisit(edit.dataset.edit); if(map){const v=state.visits.find(x=>x.id===map.dataset.map); if(v) mapVisit(v);} });
    $("newVisitButton").addEventListener("click",()=>{resetForm();$("visitDialog").showModal();});
    $("emptyAdd").addEventListener("click",()=>{resetForm();$("visitDialog").showModal();});
    $("closeDialog").addEventListener("click",()=>$("visitDialog").close());
    $("visitForm").addEventListener("submit",submitVisit);
    $("openMaps").addEventListener("click",()=>{ const v=state.editing||{name:$("name").value,address:$("address").value,city:$("city").value}; mapVisit(v); });
    $("deleteVisit").addEventListener("click",async()=>{ if(!state.editing||!confirm(`Ștergi vizita la ${state.editing.name}?`))return; await removeVisit(state.editing.id); $("visitDialog").close(); await refresh(); showToast("Vizita a fost ștearsă"); });
    $("photoInput").addEventListener("change",async e=>{ for(const file of [...e.target.files]) state.pendingPhotos.push(await resizeImage(file)); renderPhotos(); e.target.value=""; });
    $("photoGallery").addEventListener("click",e=>{ const b=e.target.closest("[data-photo]"); if(!b)return; state.pendingPhotos.splice(Number(b.dataset.photo),1); renderPhotos(); });
    $("websiteUrl").addEventListener("input", updateWebsiteLink); $("websiteCheckedAt").addEventListener("change", updateWebsiteLink);
    $("backupButton").addEventListener("click",()=>$("backupDialog").showModal()); $("closeBackup").addEventListener("click",()=>$("backupDialog").close());
    $("exportJson").addEventListener("click",exportJson); $("exportCsv").addEventListener("click",exportCsv);
    $("importJson").addEventListener("change",async e=>{ try{const data=JSON.parse(await e.target.files[0].text()); if(!Array.isArray(data.visits))throw new Error(); for(const v of data.visits) await saveVisit(v); await migrateWebsiteData(); await refresh(); $("backupDialog").close(); showToast("Backup restaurat");}catch{alert("Fișierul nu este un backup BarGig Rute valid.");} e.target.value=""; });
    window.addEventListener("online",updateConnection); window.addEventListener("offline",updateConnection);
  }
  function updateConnection(){ const el=$("offlineState"); el.classList.toggle("offline",!navigator.onLine); el.querySelector("span").textContent=navigator.onLine?"Offline pregătit":"Lucrezi offline"; }
  async function init(){ $("dateFilter").value=today(); $("visitDate").value=today(); bindEvents(); updateConnection(); await seedIfNeeded(); await migrateWebsiteData(); await refresh(); if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js"); }
  init().catch(error=>{console.error(error);alert("Aplicația nu a putut porni. Reîncarcă pagina.");});
})();
