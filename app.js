/* SabdaMu Admin (PWA): kelola kutipan di Supabase, pindai teks buku lewat kamera (OCR), dan kirim push notification. */
(function () {
  "use strict";

  var cfg = window.SABDAMU || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY);
  var sb = null;
  if (configured && window.supabase) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  }

  var app = document.getElementById("app");
  var PAGE = 60;
  var state = { user: null, tab: "quotes", quotes: [], main: null, listEl: null, searchEl: null, countEl: null, chipsEl: null, filter: "all", limit: PAGE, stopLive: null };

  var SEASONS = [
    ["ORDINARY", "Masa Biasa"], ["ADVENT", "Adven"], ["CHRISTMAS", "Natal"], ["LENT", "Prapaskah"], ["EASTER", "Paskah"]
  ];
  var SPECIAL = [
    ["ASH_WEDNESDAY", "Rabu Abu"], ["PALM_SUNDAY", "Minggu Palma"], ["HOLY_THURSDAY", "Kamis Putih"],
    ["GOOD_FRIDAY", "Jumat Agung"], ["HOLY_SATURDAY", "Sabtu Suci"], ["ASCENSION", "Kenaikan"],
    ["PENTECOST", "Pentakosta"], ["TRINITY", "Tritunggal"], ["CORPUS_CHRISTI", "Tubuh & Darah Kristus"],
    ["SACRED_HEART", "Hati Yesus"], ["CHRIST_KING", "Kristus Raja"], ["CHRISTMAS_DAY", "Hari Raya Natal"],
    ["HOLY_FAMILY", "Keluarga Kudus"], ["MARY_MOTHER", "Maria Bunda Allah"], ["EPIPHANY", "Penampakan Tuhan"],
    ["BAPTISM", "Pembaptisan Tuhan"], ["ASSUMPTION", "Maria Diangkat"], ["ALL_SAINTS", "Semua Orang Kudus"],
    ["ALL_SOULS", "Arwah"], ["IMMACULATE", "Dikandung Tanpa Noda"], ["MARY", "Hari Maria"],
    ["MARTYR", "Hari Martir"], ["APOSTLE", "Hari Rasul"], ["MISSION_SUNDAY", "Minggu Misi"]
  ];

  /* ---------------------------------------------------------------- util */
  function h(tag, props) {
    var el = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "value") el.value = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, ms || 3200);
  }

  function tidyText(t) {
    return String(t || "")
      .replace(/\r/g, "")
      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
      .replace(/-\n(\p{Lu})/gu, "-$1")
      .replace(/([^\n])\n(?!\n)/g, "$1 ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{2,}/g, "\n\n")
      .trim();
  }

  function switchEl(checked, onChange) {
    var input = h("input", { type: "checkbox" });
    input.checked = !!checked;
    input.addEventListener("change", function () { onChange(input.checked, input); });
    return h("label", { class: "switch" }, input, h("span"));
  }

  function errMessage(error) {
    if (!error) return "";
    return error.message || String(error);
  }

  /* ---------------------------------------------------------------- layar awal */
  function renderSetup() {
    clear(app);
    app.appendChild(h("div", { class: "login" },
      h("h1", { text: "SabdaMu Admin" }),
      h("div", { class: "card" },
        h("h2", { text: "Panel belum dikonfigurasi" }),
        h("p", { class: "muted", text: "Buka berkas config.js, isi SUPABASE_URL dan SUPABASE_KEY dengan data proyek Supabase Anda, lalu unggah ulang. Lihat PANDUAN_PWA.md." })
      )
    ));
  }

  function renderLogin(message) {
    clear(app);
    var email = h("input", { type: "email", placeholder: "email admin", autocomplete: "username" });
    var pass = h("input", { type: "password", placeholder: "kata sandi", autocomplete: "current-password" });
    var err = h("p", { class: "err", text: message || "" });
    var btn = h("button", { class: "btn block", text: "Masuk" });

    function submit() {
      err.textContent = "";
      btn.disabled = true;
      btn.textContent = "Memproses…";
      sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value }).then(function (res) {
        btn.disabled = false;
        btn.textContent = "Masuk";
        if (res.error) { err.textContent = "Gagal masuk: " + errMessage(res.error); return; }
        enter(res.data.user);
      });
    }
    btn.addEventListener("click", submit);
    pass.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });

    app.appendChild(h("div", { class: "login" },
      h("img", { src: "icons/icon-192.png", alt: "" }),
      h("h1", { text: "SabdaMu Admin" }),
      h("p", { class: "sub", text: "Masuk untuk mengelola kutipan dan push notification" }),
      h("label", { class: "f", text: "Email" }), email,
      h("label", { class: "f", text: "Kata sandi" }), pass,
      h("div", { class: "spacer" }), btn, err
    ));
  }

  function enter(user) {
    return sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle().then(function (res) {
      if (res.error || !res.data) {
        return sb.auth.signOut().then(function () {
          renderLogin("Akun ini bukan admin. Minta akses ke pemilik proyek.");
        });
      }
      state.user = user;
      renderShell();
      showTab("quotes");
    });
  }

  /* ---------------------------------------------------------------- kerangka */
  function renderShell() {
    clear(app);
    var header = h("header", { class: "top" },
      h("h1", { text: "SabdaMu Admin" }),
      h("button", { text: "Keluar", onclick: function () { sb.auth.signOut().then(function () { renderLogin(); }); } })
    );
    state.main = h("main");
    var tabs = h("nav", { class: "tabs" });
    [["quotes", "\uD83D\uDCD6", "Kutipan"], ["scan", "\uD83D\uDCF7", "Pindai"], ["push", "\uD83D\uDD14", "Push"]].forEach(function (t) {
      tabs.appendChild(h("button", { "data-tab": t[0], onclick: function () { showTab(t[0]); } },
        h("span", { class: "ic", text: t[1] }), t[2]));
    });
    app.appendChild(header);
    app.appendChild(state.main);
    app.appendChild(tabs);
  }

  function showTab(id) {
    stopLive();
    state.tab = id;
    var buttons = document.querySelectorAll("nav.tabs button");
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.toggle("active", buttons[i].getAttribute("data-tab") === id);
    clear(state.main);
    if (id === "quotes") renderQuotesTab();
    else if (id === "scan") renderScanTab();
    else renderPushTab();
  }

  /* ---------------------------------------------------------------- tab kutipan */
  function renderQuotesTab() {
    var search = h("input", { type: "search", placeholder: "Cari kutipan atau sumber…" });
    var chips = h("div", { class: "chips", style: "margin:10px 0" });
    var list = h("div", { class: "card compact" });
    var count = h("p", { class: "muted", style: "margin:0 0 6px" });
    state.listEl = list; state.searchEl = search; state.countEl = count; state.chipsEl = chips;
    state.limit = PAGE;
    search.addEventListener("input", function () { state.limit = PAGE; drawList(); });
    state.main.appendChild(h("div", { class: "row" },
      h("div", { class: "grow" }, search),
      h("button", { class: "btn gold small", text: "+ Tambah", onclick: function () { openEditor(null, {}); } })
    ));
    state.main.appendChild(chips);
    state.main.appendChild(count);
    state.main.appendChild(list);
    loadQuotes();
  }

  function loadQuotes() {
    if (state.listEl) { clear(state.listEl); state.listEl.appendChild(h("p", { class: "muted", text: "Memuat…" })); }
    return sb.from("quotes").select("*").order("created_at", { ascending: false }).limit(2000).then(function (res) {
      if (res.error) { toast("Gagal memuat: " + errMessage(res.error), 5000); return; }
      state.quotes = res.data || [];
      drawList();
    });
  }

  function matchFilter(x) {
    if (state.filter === "santo") return x.type === "santo";
    if (state.filter === "sabda") return x.type === "sabda";
    if (state.filter === "off") return !x.active;
    return true;
  }

  function drawChips() {
    var box = state.chipsEl;
    if (!box) return;
    var n = { all: state.quotes.length, santo: 0, sabda: 0, off: 0 };
    state.quotes.forEach(function (x) { n[x.type === "sabda" ? "sabda" : "santo"]++; if (!x.active) n.off++; });
    clear(box);
    [["all", "Semua"], ["santo", "Santo"], ["sabda", "Sabda"], ["off", "Nonaktif"]].forEach(function (f) {
      var c = h("button", { type: "button", class: "chip" + (state.filter === f[0] ? " on" : ""), text: f[1] + " " + n[f[0]] });
      c.addEventListener("click", function () { state.filter = f[0]; state.limit = PAGE; drawList(); });
      box.appendChild(c);
    });
  }

  function drawList() {
    var list = state.listEl;
    if (!list) return;
    drawChips();
    var q = (state.searchEl ? state.searchEl.value : "").trim().toLowerCase();
    var items = state.quotes.filter(function (x) {
      return matchFilter(x) && (!q || (x.text || "").toLowerCase().indexOf(q) >= 0 || (x.source || "").toLowerCase().indexOf(q) >= 0);
    });
    if (state.countEl) state.countEl.textContent = "Menampilkan " + Math.min(items.length, state.limit) + " dari " + items.length + " kutipan";
    clear(list);
    if (!items.length) {
      list.appendChild(h("p", { class: "muted", text: state.quotes.length ? "Tidak ada yang cocok." : "Belum ada kutipan. Ketuk + Tambah atau gunakan tab Pindai." }));
      return;
    }
    items.slice(0, state.limit).forEach(function (x) {
      var meta = x.source;
      if (x.feast_date) meta += " \u00B7 " + x.feast_date;
      if (x.type === "sabda" && x.tags && x.tags.length) meta += " \u00B7 " + x.tags.join(", ");
      list.appendChild(h("div", { class: "qitem" },
        h("div", { class: "body", onclick: function () { openEditor(x, {}); } },
          h("div", { class: "line1" },
            h("span", { class: "badge " + (x.type === "sabda" ? "sabda" : ""), text: x.type === "sabda" ? "SABDA" : "SANTO" }),
            x.active ? null : h("span", { class: "badge off", text: "OFF" }),
            h("span", { class: "txt1", text: x.text })),
          h("div", { class: "src", text: meta })),
        switchEl(x.active, function (on, input) {
          sb.from("quotes").update({ active: on }).eq("id", x.id).then(function (res) {
            if (res.error) { input.checked = !on; toast("Gagal: " + errMessage(res.error), 5000); return; }
            x.active = on;
            toast(on ? "Diaktifkan" : "Dinonaktifkan");
            drawList();
          });
        })
      ));
    });
    if (items.length > state.limit) {
      list.appendChild(h("button", { class: "btn secondary block", type: "button", style: "margin-top:10px",
        text: "Tampilkan " + Math.min(PAGE, items.length - state.limit) + " lagi", onclick: function () { state.limit += PAGE; drawList(); } }));
    }
  }

  /* ---------------------------------------------------------------- editor kutipan */
  function openEditor(q, preset) {
    var isNew = !q;
    var data = Object.assign({ type: "santo", text: "", source: "", note: "", feast_date: null, tags: ["ORDINARY"], active: true }, q || {}, preset || {});
    var type = data.type === "sabda" ? "sabda" : "santo";
    var tags = new Set(Array.isArray(data.tags) ? data.tags : []);

    var bg = h("div", { class: "sheet-bg" });
    var sheet = h("div", { class: "sheet" });
    bg.appendChild(sheet);
    bg.addEventListener("click", function (e) { if (e.target === bg) close(); });
    function close() { if (bg.parentNode) bg.parentNode.removeChild(bg); }

    var segSanto = h("button", { text: "Orang kudus", type: "button" });
    var segSabda = h("button", { text: "Sabda", type: "button" });
    var textEl = h("textarea", { placeholder: "Isi kutipan…", value: data.text });
    var srcLabel = h("label", { class: "f" });
    var srcEl = h("input", { type: "text", value: data.source });
    var noteWrap = h("div");
    var noteEl = h("input", { type: "text", placeholder: "mis. Pengakuan-pengakuan, I.1", value: data.note || "" });
    var dateWrap = h("div");
    var dateEl = h("input", { type: "date" });
    if (data.feast_date) dateEl.value = "2000-" + data.feast_date;
    var tagsWrap = h("div");
    var active = switchEl(data.active, function () {});
    var activeInput = active.querySelector("input");
    var err = h("p", { class: "err" });

    noteWrap.appendChild(h("label", { class: "f", text: "Karya/sumber (opsional)" }));
    noteWrap.appendChild(noteEl);
    dateWrap.appendChild(h("label", { class: "f", text: "Tanggal peringatan (opsional; kosongkan agar bergilir)" }));
    dateWrap.appendChild(h("div", { class: "row" }, h("div", { class: "grow" }, dateEl),
      h("button", { class: "btn secondary small", type: "button", text: "Hapus", onclick: function () { dateEl.value = ""; } })));

    function chip(key, label) {
      var c = h("button", { type: "button", class: "chip" + (tags.has(key) ? " on" : ""), text: label });
      c.addEventListener("click", function () {
        if (tags.has(key)) tags.delete(key); else tags.add(key);
        c.classList.toggle("on", tags.has(key));
      });
      return c;
    }
    tagsWrap.appendChild(h("label", { class: "f", text: "Muncul pada masa liturgi" }));
    tagsWrap.appendChild(h("div", { class: "chips" }, SEASONS.map(function (s) { return chip(s[0], s[1]); })));
    tagsWrap.appendChild(h("label", { class: "f", text: "Atau hari/kategori khusus" }));
    tagsWrap.appendChild(h("div", { class: "chips" }, SPECIAL.map(function (s) { return chip(s[0], s[1]); })));

    function applyType() {
      segSanto.classList.toggle("on", type === "santo");
      segSabda.classList.toggle("on", type === "sabda");
      srcLabel.textContent = type === "santo" ? "Nama santo/santa (mis. Santo Agustinus dari Hippo)" : "Rujukan ayat (mis. Yoh 3:16)";
      noteWrap.style.display = type === "santo" ? "" : "none";
      dateWrap.style.display = type === "santo" ? "" : "none";
      tagsWrap.style.display = type === "sabda" ? "" : "none";
    }
    segSanto.addEventListener("click", function () { type = "santo"; applyType(); });
    segSabda.addEventListener("click", function () { type = "sabda"; applyType(); });

    var saveBtn = h("button", { class: "btn block", text: isNew ? "Simpan kutipan" : "Simpan perubahan" });
    saveBtn.addEventListener("click", function () {
      err.textContent = "";
      var text = textEl.value.trim();
      var source = srcEl.value.trim();
      if (!text) { err.textContent = "Teks kutipan wajib diisi."; return; }
      if (!source) { err.textContent = type === "santo" ? "Nama santo/santa wajib diisi." : "Rujukan ayat wajib diisi."; return; }
      var tagList = Array.from(tags);
      var row = {
        type: type,
        text: text,
        source: source,
        note: type === "santo" ? (noteEl.value.trim() || null) : null,
        feast_date: type === "santo" && dateEl.value ? dateEl.value.slice(5) : null,
        tags: type === "sabda" ? (tagList.length ? tagList : ["ORDINARY"]) : [],
        active: activeInput.checked
      };
      saveBtn.disabled = true;
      var req = isNew ? sb.from("quotes").insert(row) : sb.from("quotes").update(row).eq("id", q.id);
      req.then(function (res) {
        saveBtn.disabled = false;
        if (res.error) { err.textContent = "Gagal menyimpan: " + errMessage(res.error); return; }
        close();
        toast(isNew ? "Kutipan ditambahkan" : "Perubahan disimpan");
        if (state.tab === "quotes") loadQuotes();
      });
    });

    var delBtn = isNew ? null : h("button", { class: "btn danger block", type: "button", text: "Hapus kutipan" });
    if (delBtn) {
      delBtn.addEventListener("click", function () {
        if (!window.confirm("Hapus kutipan ini secara permanen?")) return;
        sb.from("quotes").delete().eq("id", q.id).then(function (res) {
          if (res.error) { err.textContent = "Gagal menghapus: " + errMessage(res.error); return; }
          close();
          toast("Kutipan dihapus");
          if (state.tab === "quotes") loadQuotes();
        });
      });
    }

    sheet.appendChild(h("h2", { text: isNew ? "Tambah kutipan" : "Ubah kutipan" }));
    sheet.appendChild(h("div", { class: "spacer" }));
    sheet.appendChild(h("div", { class: "seg" }, segSanto, segSabda));
    sheet.appendChild(h("label", { class: "f", text: "Kutipan" }));
    sheet.appendChild(textEl);
    sheet.appendChild(srcLabel);
    sheet.appendChild(srcEl);
    sheet.appendChild(noteWrap);
    sheet.appendChild(dateWrap);
    sheet.appendChild(tagsWrap);
    sheet.appendChild(h("div", { class: "row", style: "margin-top:14px" }, h("span", { class: "grow", text: "Tampilkan di aplikasi" }), active));
    sheet.appendChild(err);
    sheet.appendChild(h("div", { class: "spacer" }));
    sheet.appendChild(saveBtn);
    if (delBtn) { sheet.appendChild(h("div", { class: "spacer" })); sheet.appendChild(delBtn); }
    sheet.appendChild(h("div", { class: "spacer" }));
    sheet.appendChild(h("button", { class: "btn secondary block", type: "button", text: "Batal", onclick: close }));

    applyType();
    document.body.appendChild(bg);
  }

  /* ---------------------------------------------------------------- tab pindai (kamera + OCR) */
  function preprocess(ctx, w, hgt) {
    var img = ctx.getImageData(0, 0, w, hgt);
    var d = img.data;
    var hist = new Uint32Array(256);
    var i;
    for (i = 0; i < d.length; i += 4) {
      var g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g]++;
    }
    var total = w * hgt, lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.02) { hi = i; break; } }
    if (hi - lo >= 30) {
      var k = 255 / (hi - lo);
      for (i = 0; i < d.length; i += 4) {
        var v = (d[i] - lo) * k;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function stopLive() { if (state.stopLive) { var f = state.stopLive; state.stopLive = null; f(); } }

  // Hanya baris yang tampak seperti teks (cukup huruf) agar hasil bacaan langsung tidak berisi sampah.
  function cleanLines(t) {
    return String(t || "").split("\n").filter(function (ln) {
      var letters = (ln.match(/\p{L}/gu) || []).length;
      var visible = ln.replace(/\s/g, "").length;
      return letters >= 3 && visible > 0 && letters / visible >= 0.5;
    }).join("\n");
  }

  function renderScanTab() {
    var gal = h("input", { type: "file", accept: "image/*", style: "display:none" });
    var liveBox = h("div");
    var area = h("div");
    gal.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (f) { stopLive(); clear(liveBox); loadImage(f, area); }
    });
    state.main.appendChild(h("div", { class: "card" },
      h("h2", { text: "Pindai teks dari buku" }),
      h("p", { class: "muted", text: "Arahkan kamera ke teks. Bacaan muncul langsung seperti Google Lens; ketuk Ambil teks bila sudah benar." }),
      h("button", { class: "btn block", type: "button", text: "\uD83D\uDCF7 Buka kamera (baca langsung)", onclick: function () { clear(area); startLive(liveBox, area); } }),
      h("div", { class: "spacer" }),
      h("button", { class: "btn secondary block", type: "button", text: "\uD83D\uDDBC\uFE0F Pilih foto dari galeri", onclick: function () { gal.click(); } }),
      gal));
    state.main.appendChild(liveBox);
    state.main.appendChild(area);
  }

  function startLive(box, resultBox) {
    stopLive();
    clear(box);
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) { toast("Kamera tidak didukung browser ini. Gunakan foto dari galeri.", 5000); return; }
    if (!window.Tesseract) { toast("Pembaca teks belum termuat. Periksa internet lalu muat ulang.", 5000); return; }

    md.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (stream) {
      var running = true, worker = null, guideH = 0.34, lastText = "";
      var video = h("video", { autoplay: true, playsinline: true });
      video.muted = true;
      video.srcObject = stream;
      var guide = h("div", { class: "guide" });
      var status = h("p", { class: "muted", text: "Menyiapkan pembaca teks (pertama kali mengunduh data bahasa \u00B1 10 MB)\u2026" });
      var preview = h("div", { class: "livetext", text: "" });
      var takeBtn = h("button", { class: "btn block", type: "button", text: "Ambil teks" });
      takeBtn.disabled = true;

      function applyGuide() {
        guide.style.top = ((1 - guideH) / 2 * 100) + "%";
        guide.style.height = (guideH * 100) + "%";
      }
      function close() {
        running = false;
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* abaikan */ }
        if (worker) { try { worker.terminate(); } catch (e2) { /* abaikan */ } worker = null; }
        clear(box);
      }
      state.stopLive = close;

      takeBtn.addEventListener("click", function () {
        var t = lastText;
        close();
        state.stopLive = null;
        showResult(resultBox, tidyText(t));
      });

      var tools = h("div", { class: "row wrap", style: "margin:8px 0" },
        h("button", { class: "btn secondary small", type: "button", text: "\u25B2 Bingkai lebih tinggi", onclick: function () { guideH = Math.min(0.8, guideH + 0.08); applyGuide(); } }),
        h("button", { class: "btn secondary small", type: "button", text: "\u25BC Lebih rendah", onclick: function () { guideH = Math.max(0.16, guideH - 0.08); applyGuide(); } }));
      try {
        var track = stream.getVideoTracks()[0];
        var caps = track && track.getCapabilities ? track.getCapabilities() : {};
        if (caps && caps.torch) {
          var torchOn = false;
          tools.appendChild(h("button", { class: "btn secondary small", type: "button", text: "\uD83D\uDD26 Senter", onclick: function () {
            torchOn = !torchOn;
            track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(function () { toast("Senter tidak tersedia"); });
          } }));
        }
      } catch (e) { /* senter tidak wajib */ }

      box.appendChild(h("div", { class: "card" },
        h("div", { class: "livebox" }, video, guide),
        tools, status, preview, h("div", { class: "spacer" }), takeBtn,
        h("div", { class: "spacer" }),
        h("button", { class: "btn secondary block", type: "button", text: "Tutup kamera", onclick: function () { close(); state.stopLive = null; } })));
      applyGuide();

      var canvas = document.createElement("canvas");
      function loop() {
        if (!running) return;
        if (!video.videoWidth || video.readyState < 2) { setTimeout(loop, 300); return; }
        var ready = worker ? Promise.resolve(worker) : window.Tesseract.createWorker(["ind", "eng"], 1, {
          logger: function (m) {
            if (running && m.status && m.status.indexOf("loading") === 0) status.textContent = "Menyiapkan pembaca teks\u2026 " + Math.round((m.progress || 0) * 100) + "%";
          }
        });
        ready.then(function (w) {
          if (!running) { try { w.terminate(); } catch (e) { /* abaikan */ } return null; }
          worker = w;
          var vw = video.videoWidth, vh = video.videoHeight;
          var gh = vh * guideH, gy = (vh - gh) / 2, gx = vw * 0.05, gw = vw * 0.9;
          var sc = Math.min(1, 1000 / gw);
          canvas.width = Math.max(10, Math.round(gw * sc));
          canvas.height = Math.max(10, Math.round(gh * sc));
          var cx = canvas.getContext("2d");
          cx.drawImage(video, gx, gy, gw, gh, 0, 0, canvas.width, canvas.height);
          preprocess(cx, canvas.width, canvas.height);
          return w.recognize(canvas);
        }).then(function (res) {
          if (!running || !res) return;
          var t = cleanLines(res.data.text);
          if (t.length >= 6) {
            if (t !== lastText) { lastText = t; preview.textContent = t; }
            status.textContent = "Teks terbaca. Ketuk Ambil teks, atau geser kamera untuk memperbarui.";
            takeBtn.disabled = false;
          } else if (!lastText) {
            status.textContent = "Arahkan kamera ke teks di dalam bingkai\u2026";
          }
        }).catch(function (e) {
          if (running) status.textContent = "Gagal membaca: " + errMessage(e);
        }).then(function () {
          if (running) setTimeout(loop, 250);
        });
      }
      loop();
    }).catch(function (e) {
      toast("Kamera tidak bisa dibuka: " + (e && (e.message || e.name)) + ". Izinkan akses kamera di browser.", 6000);
    });
  }

  function loadImage(file, area) {
    clear(area);
    area.appendChild(h("p", { class: "muted", text: "Memuat gambar…" }));
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var maxSide = 2200;
      var s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      var base = document.createElement("canvas");
      base.width = Math.round(img.naturalWidth * s);
      base.height = Math.round(img.naturalHeight * s);
      base.getContext("2d").drawImage(img, 0, 0, base.width, base.height);
      buildScanner(area, base);
    };
    img.onerror = function () { URL.revokeObjectURL(url); clear(area); toast("Gambar tidak dapat dibuka", 4000); };
    img.src = url;
  }

  function buildScanner(area, base) {
    clear(area);
    var view = document.createElement("canvas");
    var vctx = view.getContext("2d");
    var sel = null;
    var start = null;

    function sizeView() { view.width = base.width; view.height = base.height; }
    function draw() {
      vctx.drawImage(base, 0, 0);
      if (sel) {
        vctx.fillStyle = "rgba(0,0,0,0.55)";
        vctx.fillRect(0, 0, view.width, sel.y);
        vctx.fillRect(0, sel.y + sel.h, view.width, view.height - sel.y - sel.h);
        vctx.fillRect(0, sel.y, sel.x, sel.h);
        vctx.fillRect(sel.x + sel.w, sel.y, view.width - sel.x - sel.w, sel.h);
        vctx.strokeStyle = "#ffd36a";
        vctx.lineWidth = Math.max(3, view.width / 260);
        vctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      }
    }
    function pt(e) {
      var r = view.getBoundingClientRect();
      var x = (e.clientX - r.left) * view.width / r.width;
      var y = (e.clientY - r.top) * view.height / r.height;
      return { x: Math.max(0, Math.min(view.width, x)), y: Math.max(0, Math.min(view.height, y)) };
    }
    view.addEventListener("pointerdown", function (e) {
      try { view.setPointerCapture(e.pointerId); } catch (x) { /* abaikan */ }
      start = pt(e);
      sel = { x: start.x, y: start.y, w: 0, h: 0 };
      draw();
    });
    view.addEventListener("pointermove", function (e) {
      if (!start) return;
      var p = pt(e);
      sel = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      draw();
    });
    function endSel() {
      start = null;
      if (sel && (sel.w < view.width * 0.04 || sel.h < view.height * 0.02)) sel = null;
      draw();
    }
    view.addEventListener("pointerup", endSel);
    view.addEventListener("pointercancel", endSel);

    function rotate() {
      var r = document.createElement("canvas");
      r.width = base.height; r.height = base.width;
      var c = r.getContext("2d");
      c.translate(r.width, 0); c.rotate(Math.PI / 2);
      c.drawImage(base, 0, 0);
      base = r; sel = null; sizeView(); draw();
    }

    var bar = h("div");
    var progress = h("div", { class: "progress" }, h("div"));
    var status = h("p", { class: "muted" });
    var result = h("div");
    var readBtn = h("button", { class: "btn block", type: "button", text: "Baca teks" });

    readBtn.addEventListener("click", function () {
      if (!window.Tesseract) { toast("Pembaca teks belum termuat. Periksa internet lalu muat ulang.", 5000); return; }
      var rect = sel || { x: 0, y: 0, w: base.width, h: base.height };
      var scale = rect.w < 1600 ? Math.min(2.5, 1600 / rect.w) : 1;
      var crop = document.createElement("canvas");
      crop.width = Math.max(10, Math.round(rect.w * scale));
      crop.height = Math.max(10, Math.round(rect.h * scale));
      var cx = crop.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(base, rect.x, rect.y, rect.w, rect.h, 0, 0, crop.width, crop.height);
      preprocess(cx, crop.width, crop.height);

      readBtn.disabled = true;
      readBtn.textContent = "Membaca…";
      clear(result);
      bar.style.display = "";
      status.textContent = "Menyiapkan pembaca teks (pertama kali mengunduh data bahasa \u00B1 10 MB)…";
      window.Tesseract.recognize(crop, "ind+eng", {
        logger: function (m) {
          if (m.status === "recognizing text") {
            var pct = Math.round((m.progress || 0) * 100);
            progress.firstChild.style.width = pct + "%";
            status.textContent = "Membaca teks… " + pct + "%";
          }
        }
      }).then(function (res) {
        readBtn.disabled = false;
        readBtn.textContent = "Baca teks";
        bar.style.display = "none";
        status.textContent = "";
        showResult(result, tidyText(res.data.text));
      }).catch(function (e) {
        readBtn.disabled = false;
        readBtn.textContent = "Baca teks";
        bar.style.display = "none";
        status.textContent = "";
        toast("Gagal membaca: " + errMessage(e), 6000);
      });
    });

    bar.appendChild(progress);
    bar.style.display = "none";

    sizeView(); draw();
    area.appendChild(h("div", { class: "card" },
      h("div", { class: "scanbox" }, view),
      h("p", { class: "muted", text: "Seret di atas gambar untuk memilih bagian teks (opsional; tanpa pilihan, seluruh gambar dibaca)." }),
      h("div", { class: "row wrap" },
        h("button", { class: "btn secondary small", type: "button", text: "\u21BB Putar", onclick: rotate }),
        h("button", { class: "btn secondary small", type: "button", text: "Pilih ulang", onclick: function () { sel = null; draw(); } })),
      h("div", { class: "spacer" }), readBtn, bar, status));
    area.appendChild(result);
  }

  function showResult(result, text) {
    clear(result);
    var ta = h("textarea", { value: text, placeholder: "Tidak ada teks terbaca. Coba foto lebih terang dan pilih bagian teks saja." });
    ta.style.minHeight = "160px";
    result.appendChild(h("div", { class: "card" },
      h("h2", { text: "Hasil bacaan (bisa diedit)" }), ta,
      h("div", { class: "spacer" }),
      h("div", { class: "row wrap" },
        h("button", { class: "btn secondary small", type: "button", text: "Rapikan teks", onclick: function () { ta.value = tidyText(ta.value); } }),
        h("button", { class: "btn secondary small", type: "button", text: "Salin", onclick: function () {
          if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(function () { toast("Disalin"); });
        } })),
      h("div", { class: "spacer" }),
      h("button", { class: "btn block", type: "button", text: "\u2192 Jadikan kutipan orang kudus", onclick: function () { openEditor(null, { type: "santo", text: ta.value.trim() }); } }),
      h("div", { class: "spacer" }),
      h("button", { class: "btn gold block", type: "button", text: "\u2192 Jadikan sabda (ayat)", onclick: function () { openEditor(null, { type: "sabda", text: ta.value.trim() }); } })));
  }

  /* ---------------------------------------------------------------- tab push */
  function renderPushTab() {
    var title = h("input", { type: "text", placeholder: "Judul, mis. Selamat Hari Raya Natal", maxlength: "80" });
    var body = h("textarea", { placeholder: "Isi pesan…", maxlength: "500" });
    var token = h("input", { type: "text", placeholder: "Token perangkat (opsional, untuk uji ke 1 HP)" });
    var syncSw = switchEl(false, function () {});
    var syncInput = syncSw.querySelector("input");
    var msg = h("p", { class: "muted" });
    var btn = h("button", { class: "btn block", type: "button", text: "Kirim ke semua pengguna" });
    var hist = h("div", { class: "card" });

    function updateLabel() { btn.textContent = token.value.trim() ? "Kirim uji ke 1 perangkat" : "Kirim ke semua pengguna"; }
    token.addEventListener("input", updateLabel);

    btn.addEventListener("click", function () {
      var t = title.value.trim(), b = body.value.trim(), tk = token.value.trim();
      if (!t && !b && !syncInput.checked) { msg.className = "err"; msg.textContent = "Isi judul/pesan, atau aktifkan sinkron kutipan."; return; }
      var target = tk ? "satu perangkat (uji)" : "SEMUA pengguna";
      if (!window.confirm("Kirim ke " + target + "?")) return;
      btn.disabled = true;
      msg.className = "muted";
      msg.textContent = "Mengirim…";
      sb.functions.invoke("send-push", { body: { title: t, body: b, sync: syncInput.checked, token: tk || undefined } }).then(function (res) {
        btn.disabled = false;
        if (res.error) { return explainFnError(res.error).then(function (m) { msg.className = "err"; msg.textContent = m; }); }
        msg.className = "ok";
        msg.textContent = (res.data && res.data.message) || "Terkirim.";
        title.value = ""; body.value = "";
        loadHistory(hist);
      });
    });

    state.main.appendChild(h("div", { class: "card" },
      h("h2", { text: "Kirim push notification" }),
      h("label", { class: "f", text: "Judul" }), title,
      h("label", { class: "f", text: "Pesan" }), body,
      h("div", { class: "row", style: "margin-top:12px" },
        h("div", { class: "grow" }, h("div", { text: "Sinkronkan kutipan di HP" }), h("div", { class: "muted", text: "Aplikasi langsung mengambil kutipan terbaru dari server." })),
        syncSw),
      h("label", { class: "f", text: "Uji ke satu HP (opsional)" }), token,
      h("div", { class: "spacer" }), btn, msg));
    state.main.appendChild(h("h2", { text: "Riwayat pengiriman", style: "font-size:1rem;margin:16px 4px 8px" }));
    state.main.appendChild(hist);
    loadHistory(hist);
  }

  function explainFnError(error) {
    var ctx = error && error.context;
    if (ctx && typeof ctx.json === "function") {
      return ctx.json().then(function (j) { return (j && (j.error || j.message)) || errMessage(error); }).catch(function () { return errMessage(error); });
    }
    return Promise.resolve(errMessage(error));
  }

  function loadHistory(box) {
    clear(box);
    box.appendChild(h("p", { class: "muted", text: "Memuat…" }));
    sb.from("push_log").select("*").order("created_at", { ascending: false }).limit(20).then(function (res) {
      clear(box);
      if (res.error) { box.appendChild(h("p", { class: "err", text: "Riwayat belum tersedia: " + errMessage(res.error) })); return; }
      if (!res.data || !res.data.length) { box.appendChild(h("p", { class: "muted", text: "Belum ada pengiriman." })); return; }
      res.data.forEach(function (r) {
        var when = new Date(r.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
        box.appendChild(h("div", { class: "hist" },
          h("b", { text: r.title || (r.sync ? "(hanya sinkron kutipan)" : "(tanpa judul)") }),
          r.body ? h("div", { text: r.body }) : null,
          h("div", { class: "muted", text: when + (r.sync ? " \u00B7 + sinkron" : "") }),
          h("div", { class: r.status === "ok" ? "ok" : "bad", text: r.status === "ok" ? "Terkirim" : ("Gagal: " + (r.detail || "")) })));
      });
    });
  }

  /* ---------------------------------------------------------------- mulai */
  function boot() {
    if (!configured) { renderSetup(); return; }
    if (!sb) {
      clear(app);
      app.appendChild(h("div", { class: "login" }, h("div", { class: "card" },
        h("h2", { text: "Pustaka gagal dimuat" }),
        h("p", { class: "muted", text: "Periksa koneksi internet lalu muat ulang halaman." }))));
      return;
    }
    sb.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (session) enter(session.user); else renderLogin();
    });
  }

  window.__sabdamu = { tidyText: tidyText, preprocess: preprocess, cleanLines: cleanLines };
  boot();
})();
