// Portfolio interactions: hero signal line, project filter, click-to-load reels, copy email.
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- sticky header state ---------- */
  const header = document.querySelector(".site-header");
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > window.innerHeight * 0.6);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- engine viewport ----------
     A tiny wireframe "editor viewport" rendered on a 2D canvas with a hand-rolled
     perspective projection: meshes on a grid, an XYZ gizmo, click-to-select with
     bounds, and steering agents that wander, avoid the meshes and flee the cursor.
     Drag to orbit; O toggles auto-orbit, P pauses, T switches theme.
     The HUD reports real numbers: frame rate, frame time, triangles, draw calls. */
  const canvas = document.getElementById("scene");
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext("2d");
    const $ = (id) => document.getElementById(id);
    const hud = {
      fps: $("hud-fps"), ms: $("hud-ms"), entities: $("hud-entities"),
      tris: $("hud-tris"), draws: $("hud-draws"), selected: $("hud-selected"),
      orbit: $("hud-orbit"), pause: $("hud-pause"), theme: $("hud-theme"),
    };

    const FLOOR = -0.55;
    const GRID = 2.2;              // grid half-size in world units

    /* ---- colours from CSS ---- */
    let C = {};
    const readColours = () => {
      const css = getComputedStyle(document.documentElement);
      const v = (n, d) => css.getPropertyValue(n).trim() || d;
      C = { ink: v("--ink", "#141414"), line: v("--line", "#ababa7"), muted: v("--muted", "#565653"), signal: v("--signal", "#2b44e0") };
    };
    readColours();

    /* ---- meshes ---- */
    const edgesFromFaces = (faces) => {
      const seen = new Set(), out = [];
      faces.forEach((f) => {
        for (let i = 0; i < f.length; i++) {
          const a = f[i], b = f[(i + 1) % f.length];
          const k = a < b ? a + "_" + b : b + "_" + a;
          if (!seen.has(k)) { seen.add(k); out.push([a, b]); }
        }
      });
      return out;
    };

    const cube = (s) => {
      const v = [];
      for (let i = 0; i < 8; i++) v.push([(i & 1 ? s : -s), (i & 2 ? s : -s), (i & 4 ? s : -s)]);
      const e = [];
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        const d = i ^ j; if (d === 1 || d === 2 || d === 4) e.push([i, j]);
      }
      return { v, e, tris: 12 };
    };

    const icosphere = (r) => {
      const t = (1 + Math.sqrt(5)) / 2;
      let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
      let f = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
      const norm = (p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l * r, p[1] / l * r, p[2] / l * r]; };
      v = v.map(norm);
      const cache = new Map();
      const mid = (a, b) => {
        const k = a < b ? a + "_" + b : b + "_" + a;
        if (cache.has(k)) return cache.get(k);
        const p = norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]);
        v.push(p); cache.set(k, v.length - 1); return v.length - 1;
      };
      const f2 = [];
      f.forEach(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); f2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); });
      return { v, e: edgesFromFaces(f2), tris: f2.length };
    };

    const torus = (R, r, nu, nv) => {
      const v = [], e = [];
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const u = (i / nu) * Math.PI * 2, w = (j / nv) * Math.PI * 2;
        v.push([(R + r * Math.cos(w)) * Math.cos(u), r * Math.sin(w), (R + r * Math.cos(w)) * Math.sin(u)]);
        const id = i * nv + j;
        e.push([id, ((i + 1) % nu) * nv + j], [id, i * nv + ((j + 1) % nv)]);
      }
      return { v, e, tris: nu * nv * 2 };
    };

    const objects = [
      { name: "Cube", mesh: cube(0.3), pos: [-1.05, 0.05, 0.35], spin: 0.5, tilt: 0.25, rot: 0.4 },
      { name: "Icosphere", mesh: icosphere(0.38), pos: [0.1, 0.2, -0.55], spin: 0.25, tilt: 0, rot: 0 },
      { name: "Torus", mesh: torus(0.36, 0.12, 18, 8), pos: [1.05, 0.0, 0.45], spin: 0.7, tilt: 0.9, rot: 1.2 },
    ];
    const triCount = objects.reduce((n, o) => n + o.mesh.tris, 0);

    /* ---- agents ---- */
    const AGENTS = 7;
    const agents = [];
    for (let i = 0; i < AGENTS; i++) {
      const a = (i / AGENTS) * Math.PI * 2;
      agents.push({ x: Math.cos(a) * 1.5, z: Math.sin(a) * 1.5, h: a + Math.PI / 2, wander: 0, trail: [] });
    }

    /* ---- camera ---- */
    let w = 0, h = 0, dpr = 1, f = 1, cx = 0, cyy = 0;
    let yaw = -0.62, pitch = 0.5;
    const DIST = 5.4;
    let orbit = !reduceMotion, paused = false;
    let simTime = 0, last = performance.now();
    let pointer = null, hoverObj = null, selected = null;
    let dragging = false, dragMoved = 0, dragX = 0, dragY = 0;
    let visible = true, raf = 0;
    let fpsAcc = 0, fpsFrames = 0, msAvg = 16.7, hudTimer = 0, drawCalls = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      f = w > 600 ? Math.min(w * 0.6, h * 1.0) : w * 1.2;
      cx = w > 900 ? w * 0.6 : w * 0.5;
      cyy = h * (w > 900 ? 0.52 : 0.63);
      if (!raf) render();
    };

    // world -> camera space -> screen
    const project = (x, y, z) => {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const s = f / (z2 + DIST);
      return [cx + x1 * s, cyy - y2 * s, z2];
    };

    // screen -> point on the floor plane (inverse of project), or null
    const screenToFloor = (sx, sy) => {
      const cy = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      // ray in camera space; camera sits at z = -DIST looking down +z
      let o = [0, 0, -DIST], d = [(sx - cx) / f, (cyy - sy) / f, 1];
      const unPitch = (p) => [p[0], p[1] * cp + p[2] * sp, -p[1] * sp + p[2] * cp];
      const unYaw = (p) => [p[0] * cy + p[2] * syw, p[1], -p[0] * syw + p[2] * cy];
      o = unYaw(unPitch(o)); d = unYaw(unPitch(d));
      if (Math.abs(d[1]) < 1e-5) return null;
      const t = (FLOOR - o[1]) / d[1];
      if (t <= 0) return null;
      const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
      return Math.abs(x) <= GRID && Math.abs(z) <= GRID ? [x, z] : null;
    };

    const objectWorldVerts = (o) => {
      const cr = Math.cos(o.rot), sr = Math.sin(o.rot), ct = Math.cos(o.tilt), st = Math.sin(o.tilt);
      const bob = Math.sin(simTime * 1.1 + o.pos[0] * 2) * 0.05;
      return o.mesh.v.map(([x, y, z]) => {
        const y1 = y * ct - z * st, z1 = y * st + z * ct;      // tilt (X)
        const x2 = x * cr + z1 * sr, z2 = -x * sr + z1 * cr;  // spin (Y)
        return [x2 + o.pos[0], y1 + o.pos[1] + bob, z2 + o.pos[2]];
      });
    };

    function stroke() { ctx.stroke(); drawCalls++; }

    function render() {
      drawCalls = 0;
      ctx.clearRect(0, 0, w, h);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // grid: minor then major lines
      for (const [step, alpha] of [[0.275, 0.45], [1.1, 1]]) {
        ctx.strokeStyle = C.line; ctx.globalAlpha = alpha; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let g = -GRID; g <= GRID + 1e-6; g += step) {
          let a = project(g, FLOOR, -GRID), b = project(g, FLOOR, GRID);
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          a = project(-GRID, FLOOR, g); b = project(GRID, FLOOR, g);
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        }
        stroke();
      }
      ctx.globalAlpha = 1;

      // XYZ gizmo at the grid corner
      const gx = -GRID, gz = GRID, o = project(gx, FLOOR, gz);
      const axes = [["X", [gx + 0.45, FLOOR, gz], "#c8473f"], ["Y", [gx, FLOOR + 0.45, gz], "#3f9a57"], ["Z", [gx, FLOOR, gz - 0.45], C.signal]];
      ctx.lineWidth = 2;
      ctx.font = "700 11px Urbanist, system-ui, sans-serif";
      axes.forEach(([label, p, col]) => {
        const q = project(p[0], p[1], p[2]);
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(q[0], q[1]); stroke();
        ctx.fillStyle = col; ctx.fillText(label, q[0] + 4, q[1] - 4);
      });

      // agent trails, then agents
      ctx.lineWidth = 1; ctx.strokeStyle = C.muted;
      agents.forEach((a) => {
        if (a.trail.length < 2) return;
        ctx.globalAlpha = 0.35; ctx.beginPath();
        a.trail.forEach(([x, z], i) => { const p = project(x, FLOOR, z); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
        stroke();
      });
      ctx.globalAlpha = 1; ctx.fillStyle = C.ink;
      ctx.beginPath();
      agents.forEach((a) => {
        const s = 0.065, fx = Math.cos(a.h), fz = Math.sin(a.h);
        const tip = project(a.x + fx * s * 1.6, FLOOR, a.z + fz * s * 1.6);
        const l = project(a.x - fx * s - fz * s, FLOOR, a.z - fz * s + fx * s);
        const r = project(a.x - fx * s + fz * s, FLOOR, a.z - fz * s - fx * s);
        ctx.moveTo(tip[0], tip[1]); ctx.lineTo(l[0], l[1]); ctx.lineTo(r[0], r[1]); ctx.closePath();
      });
      ctx.fill(); drawCalls++;

      // cursor ring on the floor
      if (pointer) {
        ctx.strokeStyle = C.signal; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 32; i++) {
          const t = (i / 32) * Math.PI * 2, p = project(pointer[0] + Math.cos(t) * 0.55, FLOOR, pointer[1] + Math.sin(t) * 0.55);
          i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
        }
        stroke(); ctx.globalAlpha = 1;
      }

      // meshes: shadow footprint + wireframe
      objects.forEach((obj) => {
        const verts = objectWorldVerts(obj);
        const pts = verts.map((v) => project(v[0], v[1], v[2]));
        obj.screen = pts;

        // soft drop shadow: object's footprint projected onto the floor
        ctx.globalAlpha = 0.12; ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
        ctx.beginPath();
        obj.mesh.e.forEach(([a, b]) => {
          const p = project(verts[a][0], FLOOR, verts[a][2]), q = project(verts[b][0], FLOOR, verts[b][2]);
          ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
        });
        stroke();

        const isSel = obj === selected, isHover = obj === hoverObj;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = isSel || isHover ? C.signal : C.ink;
        ctx.lineWidth = isSel ? 1.6 : 1.1;
        ctx.beginPath();
        obj.mesh.e.forEach(([a, b]) => { ctx.moveTo(pts[a][0], pts[a][1]); ctx.lineTo(pts[b][0], pts[b][1]); });
        stroke();

        // screen-space bounds, used for picking and the selection brackets
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
        obj.bounds = [x0, y0, x1, y1];

        if (isSel) {
          const pad = 8, L = 12;
          x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
          ctx.strokeStyle = C.signal; ctx.lineWidth = 1.5;
          ctx.beginPath();
          [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([x, y, dx, dy]) => {
            ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L);
          });
          stroke();
          ctx.fillStyle = C.signal;
          ctx.font = "700 12px Urbanist, system-ui, sans-serif";
          ctx.fillText(`${obj.name}  ${obj.mesh.tris} tris`, x0, y0 - 8);
        }
      });
      ctx.globalAlpha = 1;
    }

    /* ---- simulation ---- */
    const stepAgents = (dt) => {
      agents.forEach((a, i) => {
        a.wander += (Math.random() - 0.5) * 3 * dt;
        let dx = Math.cos(a.h + a.wander * 0.6), dz = Math.sin(a.h + a.wander * 0.6);
        let speed = 0.42;

        // stay on the grid
        const edge = GRID - 0.35;
        if (Math.abs(a.x) > edge || Math.abs(a.z) > edge) { dx += -a.x * 1.5; dz += -a.z * 1.5; }

        // keep clear of the meshes
        objects.forEach((o) => {
          const ox = a.x - o.pos[0], oz = a.z - o.pos[2], d = Math.hypot(ox, oz);
          if (d < 0.6) { dx += (ox / d) * (0.6 - d) * 6; dz += (oz / d) * (0.6 - d) * 6; }
        });

        // separation from other agents
        agents.forEach((b, j) => {
          if (i === j) return;
          const sx = a.x - b.x, sz = a.z - b.z, d = Math.hypot(sx, sz);
          if (d > 0 && d < 0.3) { dx += (sx / d) * (0.3 - d) * 4; dz += (sz / d) * (0.3 - d) * 4; }
        });

        // flee the cursor
        if (pointer) {
          const px = a.x - pointer[0], pz = a.z - pointer[1], d = Math.hypot(px, pz);
          if (d < 0.9 && d > 0) { dx += (px / d) * (0.9 - d) * 8; dz += (pz / d) * (0.9 - d) * 8; speed = 1.1; }
        }

        // turn smoothly toward the desired heading
        const want = Math.atan2(dz, dx);
        let diff = want - a.h;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        a.h += diff * Math.min(1, dt * 4);
        a.x += Math.cos(a.h) * speed * dt;
        a.z += Math.sin(a.h) * speed * dt;

        a.trail.push([a.x, a.z]);
        if (a.trail.length > 40) a.trail.shift();
      });
    };

    const tick = (now) => {
      const frameMs = now - last;
      const dt = Math.min(0.05, frameMs / 1000);
      last = now;

      if (!paused) {
        simTime += dt;
        objects.forEach((o) => { o.rot += o.spin * dt; });
        stepAgents(dt);
      }
      if (orbit && !dragging) yaw += dt * 0.1;

      render();

      fpsAcc += frameMs; fpsFrames++;
      msAvg += (frameMs - msAvg) * 0.1;
      hudTimer += frameMs;
      if (hudTimer > 250) {
        hud.fps.textContent = String(Math.round(1000 / (fpsAcc / fpsFrames))).padStart(6, "0");
        hud.ms.textContent = msAvg.toFixed(1).padStart(4, "0") + " ms";
        hud.draws.textContent = String(drawCalls).padStart(2, "0");
        fpsAcc = 0; fpsFrames = 0; hudTimer = 0;
      }
      raf = visible ? requestAnimationFrame(tick) : 0;
    };

    /* ---- HUD + controls ---- */
    const setOrbit = (on) => { orbit = on; hud.orbit.setAttribute("aria-pressed", String(on)); hud.orbit.querySelector("b").textContent = on ? "On" : "Off"; };
    const setPaused = (on) => { paused = on; hud.pause.setAttribute("aria-pressed", String(on)); hud.pause.querySelector("b").textContent = on ? "On" : "Off"; };
    const syncThemeLabel = () => { hud.theme.querySelector("b").textContent = document.documentElement.dataset.theme === "dark" ? "Dark" : "Light"; };
    const setSelected = (o) => { selected = o; hud.selected.textContent = o ? o.name : "None"; if (!raf) render(); };

    hud.entities.textContent = String(objects.length + agents.length).padStart(2, "0");
    hud.tris.textContent = triCount.toLocaleString("en-US");
    hud.orbit.addEventListener("click", () => setOrbit(!orbit));
    hud.pause.addEventListener("click", () => setPaused(!paused));
    hud.theme.addEventListener("click", () => document.querySelector(".theme-toggle").click());
    document.addEventListener("themechange", () => { readColours(); syncThemeLabel(); if (!raf) render(); });
    syncThemeLabel();
    setOrbit(orbit);

    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (k === "o") setOrbit(!orbit);
      else if (k === "p") setPaused(!paused);
      else if (k === "t") document.querySelector(".theme-toggle").click();
      else if (k === "escape" && selected) setSelected(null);
    });

    const pick = (x, y) => {
      let best = null, bestD = Infinity;
      objects.forEach((o) => {
        if (!o.bounds) return;
        const [x0, y0, x1, y1] = o.bounds;
        if (x >= x0 - 10 && x <= x1 + 10 && y >= y0 - 10 && y <= y1 + 10) {
          const d = Math.hypot(x - (x0 + x1) / 2, y - (y0 + y1) / 2);
          if (d < bestD) { bestD = d; best = o; }
        }
      });
      return best;
    };

    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (dragging) {
        dragMoved += Math.abs(e.clientX - dragX) + Math.abs(e.clientY - dragY);
        yaw += (e.clientX - dragX) * 0.006;
        pitch = Math.min(1.25, Math.max(0.12, pitch + (e.clientY - dragY) * 0.004));
        dragX = e.clientX; dragY = e.clientY;
      }
      pointer = e.pointerType === "mouse" ? screenToFloor(x, y) : null;
      hoverObj = pick(x, y);
      canvas.style.cursor = dragging ? "grabbing" : hoverObj ? "pointer" : "grab";
      if (!raf) render();
    });
    canvas.addEventListener("pointerleave", () => { pointer = null; hoverObj = null; });
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true; dragMoved = 0; dragX = e.clientX; dragY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    const endDrag = (e) => {
      if (dragging && dragMoved < 5 && e.type === "pointerup") {
        const r = canvas.getBoundingClientRect();
        setSelected(pick(e.clientX - r.left, e.clientY - r.top));
      }
      dragging = false;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    window.addEventListener("resize", resize);
    resize();

    if (reduceMotion) {
      setOrbit(false);
      render();
    } else {
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
      }).observe(canvas);
      raf = requestAnimationFrame(tick);
    }
  }

  /* ---------- light / dark theme ---------- */
  const root = document.documentElement;
  const toggle = document.querySelector(".theme-toggle");
  const syncToggle = () => {
    const dark = root.dataset.theme === "dark";
    toggle.setAttribute("aria-pressed", String(dark));
  };
  if (toggle) {
    syncToggle();
    toggle.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* storage unavailable */ }
      syncToggle();
      document.dispatchEvent(new Event("themechange"));
    });
  }

  /* ---------- low-health warning demo ----------
     A browser recreation of the Ember's Escape warning: as heat drops below
     the threshold, a vignette closes in and the fire's crackle is low-passed. */
  const heat = document.getElementById("heat");
  if (heat) {
    const stage = document.querySelector(".demo-stage");
    const readout = document.getElementById("heat-value");
    const soundBtn = document.querySelector(".demo-sound");
    const THRESHOLD = 0.4;
    let audio = null;

    const warnAmount = (h) => Math.min(1, Math.max(0, (THRESHOLD - h) / THRESHOLD));

    const update = () => {
      const h = heat.value / 100;
      const warn = warnAmount(h);
      stage.style.setProperty("--heat", h.toFixed(3));
      stage.style.setProperty("--warn", warn.toFixed(3));
      stage.classList.toggle("is-critical", h < 0.15);
      readout.textContent = heat.value;
      if (audio) {
        // full heat: bright crackle (~9 kHz). Low heat: muffled (~350 Hz).
        const cutoff = 350 * Math.pow(9000 / 350, 1 - warn);
        audio.filter.frequency.setTargetAtTime(cutoff, audio.ctx.currentTime, 0.05);
        audio.gain.gain.setTargetAtTime(0.5 + 0.5 * h, audio.ctx.currentTime, 0.05);
      }
    };

    const startAudio = () => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();

      // two seconds of brown noise for the fire's body
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.2;
      }
      const body = ctx.createBufferSource();
      body.buffer = buf;
      body.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 9000;
      filter.Q.value = 0.7;

      const gain = ctx.createGain();
      gain.gain.value = 1;
      const master = ctx.createGain();
      master.gain.value = 0.35;

      body.connect(filter);
      filter.connect(gain).connect(master).connect(ctx.destination);
      body.start();

      // random crackles: short bursts of white noise
      const crackle = () => {
        if (ctx.state === "closed") return;
        if (ctx.state === "suspended") { audio.timer = setTimeout(crackle, 250); return; }
        const n = Math.floor(ctx.sampleRate * 0.012);
        const b = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        g.gain.value = 0.25 + Math.random() * 0.5;
        src.buffer = b;
        src.connect(g).connect(filter);
        src.start();
        audio.timer = setTimeout(crackle, 40 + Math.random() * 260 * (1.4 - heat.value / 100));
      };

      audio = { ctx, filter, gain, timer: 0 };
      crackle();
      return audio;
    };

    soundBtn.addEventListener("click", async () => {
      const on = soundBtn.getAttribute("aria-pressed") !== "true";
      if (on) {
        if (!audio) startAudio();
        else await audio.ctx.resume();
        if (!audio) { soundBtn.textContent = "Sound isn't supported here"; return; }
        update();
      } else if (audio) {
        await audio.ctx.suspend();
      }
      soundBtn.setAttribute("aria-pressed", String(on));
      soundBtn.textContent = on ? "Turn sound off" : "Turn sound on";
    });

    heat.addEventListener("input", update);
    update();
  }

  /* ---------- project filter ---------- */
  const filterButtons = document.querySelectorAll(".filter button");
  const items = document.querySelectorAll(".work .project, .work .index-row");
  const rows = document.querySelectorAll(".work .wi-row");
  const status = document.getElementById("filter-status");
  const indexTitle = document.querySelector(".index-title");
  const countEl = document.getElementById("work-count");
  const totalEl = document.getElementById("work-total");
  const pad = (n) => String(n).padStart(2, "0");
  if (totalEl) totalEl.textContent = pad(items.length);
  if (countEl) countEl.textContent = pad(items.length);

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.filter;
      const matches = (el) => tag === "all" || el.dataset.tags.split(" ").includes(tag);
      filterButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));

      let shown = 0, shownInIndex = 0;
      items.forEach((el) => {
        const m = matches(el);
        el.classList.toggle("is-hidden", !m);
        if (m) { shown++; if (el.classList.contains("index-row")) shownInIndex++; }
      });
      rows.forEach((el) => el.classList.toggle("is-hidden", !matches(el)));
      if (indexTitle) indexTitle.style.display = shownInIndex === 0 ? "none" : "";
      if (countEl) countEl.textContent = pad(shown);

      status.textContent = tag === "all"
        ? ""
        : `Showing ${shown} of ${items.length} projects tagged “${btn.textContent}”.`;
    });
  });

  /* ---------- click-to-load YouTube players ---------- */
  // YouTube refuses to play embeds that arrive without a Referer header (error 153).
  // A page opened straight from disk (file://) never sends one, so there we open
  // the video on YouTube instead. Served over http(s), e.g. GitHub Pages, it plays inline.
  const canEmbed = location.protocol === "http:" || location.protocol === "https:";

  const mountYT = (btn) => {
    if (!canEmbed) {
      btn.addEventListener("click", () => {
        window.open(`https://www.youtube.com/watch?v=${btn.dataset.id}`, "_blank", "noopener");
      });
      return;
    }
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      iframe.title = btn.getAttribute("aria-label").replace(/^Play /, "");
      iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      const frame = document.createElement("div");
      frame.className = "yt";
      frame.appendChild(iframe);
      btn.replaceWith(frame);
      iframe.focus();
    }, { once: true });
  };
  document.querySelectorAll("button.yt").forEach(mountYT);

  /* ---------- tabbed project videos ---------- */
  document.querySelectorAll(".video-tabs").forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const panel = document.getElementById(tabs[0].getAttribute("aria-controls"));
    const note = list.closest(".project-video").querySelector(".video-note");

    const select = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
      });
      panel.setAttribute("aria-labelledby", tab.id);
      const id = tab.dataset.id;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "yt";
      btn.dataset.id = id;
      btn.setAttribute("aria-label", "Play " + tab.dataset.label);
      btn.innerHTML = `<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" width="480" height="360"><span class="play" aria-hidden="true"></span>`;
      panel.replaceChildren(btn);
      mountYT(btn);
      if (note) note.textContent = tab.dataset.note;
      if (focus) tab.focus();
    };

    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => { if (tab.getAttribute("aria-selected") !== "true") select(tab); });
      tab.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        select(tabs[(i + step + tabs.length) % tabs.length], true);
      });
    });
  });

  /* ---------- copy email ---------- */
  document.querySelectorAll(".copy").forEach((btn) => {
    const label = btn.textContent;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = "Email copied";
      } catch {
        btn.textContent = "Copy failed. Select the address above.";
      }
      setTimeout(() => { btn.textContent = label; }, 2200);
    });
  });
})();
