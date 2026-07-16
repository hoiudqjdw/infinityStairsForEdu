(() => {
  "use strict";

  // ---------- Canvas setup ----------
  const stage = document.getElementById("stage");
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let viewW = 0, viewH = 0;

  function resize() {
    const rect = stage.getBoundingClientRect();
    viewW = rect.width;
    viewH = rect.height;
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Constants ----------
  const STEP_DX = 46;   // horizontal distance per step (world units)
  const STEP_DY = 44;   // vertical rise per step
  const ANIM_MS = 140;  // step animation duration
  const STUMBLE_MS = 220;

  const TIME_MAX = 100;        // timer bar units, full at game start
  const BASE_DRAIN_RATE = 9;   // units/sec passively drained
  const TIME_BONUS = 7;        // units restored per correct step

  // ---------- Game state ----------
  let state = "start"; // start | playing | gameover
  let steps = [];       // {x, y, dir}  dir: 'L' | 'R' — direction needed to step onto this from previous
  let currentIndex = 0;
  let curDir = "R";
  let runRemaining = 3;

  let charPos = { x: 0, y: 0 };   // rendered (animated) position, world coords
  let animFrom = null, animTo = null, animStart = 0, animKind = null; // 'move' | 'stumble'
  let isAnimating = false;

  let timeLeft = TIME_MAX;
  let floor = 0;
  let elapsedPlaying = 0;
  let lastTime = 0;

  let camera = { x: 0, y: 0 };
  let shake = 0;

  const keys = {};

  // ---------- Audio ----------
  const bgm = new Audio("audio/bgm.mp3");
  bgm.loop = true;
  bgm.volume = 0.45;

  const sfxSources = {
    step: "audio/step.wav",
    miss: "audio/miss.wav",
    click: "audio/click.wav",
    gameover: "audio/gameover.mp3",
  };
  const sfx = {};
  for (const key in sfxSources) sfx[key] = new Audio(sfxSources[key]);

  let muted = false;

  function playSfx(name) {
    if (muted) return;
    const src = sfx[name];
    const node = src.cloneNode();
    node.volume = name === "gameover" ? 0.8 : 0.6;
    node.play().catch(() => {});
  }

  function setMuted(next) {
    muted = next;
    bgm.muted = muted;
    btnMute.textContent = muted ? "🔇" : "🔊";
  }

  const btnMute = document.getElementById("btnMute");
  btnMute.addEventListener("click", () => setMuted(!muted));

  // ---------- Step generation ----------
  function makeStartStep() {
    return { x: 0, y: 0, dir: null };
  }

  function genNextStep(prev) {
    if (runRemaining <= 0) {
      curDir = curDir === "R" ? "L" : "R";
      const maxRun = Math.max(2, 5 - Math.floor(floor / 40));
      runRemaining = 2 + Math.floor(Math.random() * (maxRun - 1));
    }
    runRemaining--;
    const dx = curDir === "R" ? STEP_DX : -STEP_DX;
    return { x: prev.x + dx, y: prev.y - STEP_DY, dir: curDir };
  }

  function ensureBuffer() {
    while (steps.length < currentIndex + 24) {
      steps.push(genNextStep(steps[steps.length - 1]));
    }
  }

  function resetGame() {
    steps = [makeStartStep()];
    currentIndex = 0;
    curDir = Math.random() < 0.5 ? "L" : "R";
    runRemaining = 3;
    ensureBuffer();

    charPos = { x: steps[0].x, y: steps[0].y };
    animFrom = animTo = null;
    isAnimating = false;

    timeLeft = TIME_MAX;
    floor = 0;
    elapsedPlaying = 0;

    camera.x = charPos.x;
    camera.y = charPos.y;
    shake = 0;

    updateFloorLabel();
    updateGauge();
  }

  // ---------- Input ----------
  function tryStep(pressedDir) {
    if (state !== "playing") return;
    if (isAnimating) return;

    const target = steps[currentIndex + 1];
    if (target.dir === pressedDir) {
      // success
      animFrom = { x: charPos.x, y: charPos.y };
      animTo = { x: target.x, y: target.y };
      animStart = performance.now();
      animKind = "move";
      isAnimating = true;

      currentIndex++;
      floor++;
      timeLeft = Math.min(TIME_MAX, timeLeft + TIME_BONUS);
      ensureBuffer();
      updateFloorLabel();
      playSfx("step");
    } else {
      // miss — a single wrong step ends the run immediately
      animFrom = { x: charPos.x, y: charPos.y };
      animTo = { x: charPos.x + (pressedDir === "R" ? 10 : -10), y: charPos.y };
      animStart = performance.now();
      animKind = "stumble";
      isAnimating = true;

      shake = 1;
      playSfx("miss");
      triggerGameOver("miss");
    }
  }

  function pressButton(dir, btnEl) {
    if (btnEl) {
      btnEl.classList.add("pressed");
      setTimeout(() => btnEl.classList.remove("pressed"), 100);
    }
    if (state === "start") {
      startGame();
      return;
    }
    if (state === "gameover") return;
    tryStep(dir);
  }

  const btnLeft = document.getElementById("btnLeft");
  const btnRight = document.getElementById("btnRight");

  btnLeft.addEventListener("pointerdown", (e) => { e.preventDefault(); pressButton("L", btnLeft); });
  btnRight.addEventListener("pointerdown", (e) => { e.preventDefault(); pressButton("R", btnRight); });

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") pressButton("L", btnLeft);
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") pressButton("R", btnRight);
  });

  document.getElementById("btnStart").addEventListener("click", () => { playSfx("click"); startGame(); });
  document.getElementById("btnRetry").addEventListener("click", () => { playSfx("click"); startGame(); });

  function startGame() {
    resetGame();
    state = "playing";
    document.getElementById("startScreen").classList.add("hidden");
    document.getElementById("gameOverScreen").classList.add("hidden");
    bgm.currentTime = 0;
    if (!muted) bgm.play().catch(() => {});
  }

  function triggerGameOver(reason) {
    if (state !== "playing") return;
    state = "gameover";
    document.getElementById("finalFloor").textContent = floor;
    document.getElementById("gameOverTitle").textContent =
      reason === "miss" ? "헛디뎠다!" : "시간 초과!";
    document.getElementById("gameOverScreen").classList.remove("hidden");
    bgm.pause();
    playSfx("gameover");
  }

  // ---------- HUD ----------
  const gaugeFillEl = document.getElementById("gaugeFill");
  const floorNumEl = document.getElementById("floorNum");

  function updateGauge() {
    const pct = (timeLeft / TIME_MAX) * 100;
    gaugeFillEl.style.width = pct + "%";
    gaugeFillEl.style.background = pct <= 25
      ? "linear-gradient(180deg, #ff6b5c, #c72a2a)"
      : pct <= 55
        ? "linear-gradient(180deg, #ffcf5c, #d68a1f)"
        : "linear-gradient(180deg, #7ee88a, #2fa84a)";
  }
  function updateFloorLabel() {
    floorNumEl.textContent = floor;
  }

  // ---------- Update ----------
  function update(dt) {
    if (state !== "playing") return;

    elapsedPlaying += dt;
    const rate = BASE_DRAIN_RATE + Math.min(6, floor / 30);
    timeLeft = Math.max(0, timeLeft - rate * dt);
    updateGauge();

    if (timeLeft <= 0) {
      triggerGameOver("time");
      return;
    }

    // resolve animation
    if (isAnimating) {
      const t = Math.min(1, (performance.now() - animStart) / (animKind === "move" ? ANIM_MS : STUMBLE_MS));
      const ease = 1 - Math.pow(1 - t, 2);
      charPos.x = animFrom.x + (animTo.x - animFrom.x) * ease;
      charPos.y = animFrom.y + (animTo.y - animFrom.y) * ease;
      if (t >= 1) {
        isAnimating = false;
        if (animKind === "stumble") {
          charPos.x = animFrom.x;
          charPos.y = animFrom.y;
        } else {
          charPos.x = animTo.x;
          charPos.y = animTo.y;
        }
      }
    }

    // camera follows character
    const followSpeed = 10;
    camera.x += (charPos.x - camera.x) * Math.min(1, followSpeed * dt);
    camera.y += (charPos.y - camera.y) * Math.min(1, followSpeed * dt);

    if (shake > 0) shake = Math.max(0, shake - dt * 4);
  }

  // ---------- Rendering ----------
  const COLORS = {
    sky1: "#6ec6e8",
    sky2: "#bfe8f2",
    buildingA: "#3f7fae",
    buildingB: "#356a92",
    brick: "#c9a876",
    brickDark: "#a8875a",
    brickLine: "#8a6a42",
    stepEdge: "#5a4326",
    skin: "#f0c090",
    hair: "#2b2118",
    shirt: "#2f5fa8",
    pants: "#28324a",
    tie: "#c23a3a",
  };

  function worldToScreen(wx, wy) {
    return {
      x: viewW / 2 + (wx - camera.x),
      y: viewH * 0.62 + (wy - camera.y),
    };
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, COLORS.sky1);
    g.addColorStop(1, COLORS.sky2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);

    // simple parallax buildings (blocky)
    const parallax = camera.y * 0.35;
    ctx.fillStyle = COLORS.buildingA;
    for (let i = -2; i < 8; i++) {
      const bw = 46;
      const bx = (i * 70) - ((camera.x * 0.25 + 20) % 70);
      const bh = 90 + ((i * 53) % 120);
      const by = viewH - bh + (parallax % 200) - 100;
      ctx.fillRect(bx, by, bw, bh + 400);
    }
    ctx.fillStyle = COLORS.buildingB;
    for (let i = -2; i < 8; i++) {
      const bw = 30;
      const bx = 20 + (i * 90) - ((camera.x * 0.15 + 40) % 90);
      const bh = 60 + ((i * 37) % 90);
      const by = viewH - bh + (parallax % 260) - 130;
      ctx.fillRect(bx, by, bw, bh + 400);
    }
  }

  function drawStep(step) {
    const p = worldToScreen(step.x, step.y);
    const w = STEP_DX + 24;
    const h = 16;
    const x = p.x - w / 2;
    const y = p.y;

    // shadow/support column down to bottom of screen
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(x + 6, y + h, w - 12, Math.max(0, viewH - (y + h)));

    // brick platform
    ctx.fillStyle = COLORS.brick;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.brickDark;
    ctx.fillRect(x, y + h - 5, w, 5);

    // brick pattern lines
    ctx.strokeStyle = COLORS.brickLine;
    ctx.lineWidth = 1;
    const cell = 12;
    for (let cx = 0; cx < w; cx += cell) {
      ctx.beginPath();
      ctx.moveTo(x + cx, y);
      ctx.lineTo(x + cx, y + h - 5);
      ctx.stroke();
    }
    ctx.strokeStyle = COLORS.stepEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function drawCharacter() {
    const p = worldToScreen(charPos.x, charPos.y);
    const facing = curDir === "R" ? 1 : -1;
    const bob = isAnimating && animKind === "move" ? -6 : 0;
    const wobble = isAnimating && animKind === "stumble" ? Math.sin(performance.now() / 20) * 3 : 0;

    ctx.save();
    ctx.translate(p.x + wobble, p.y - 30 + bob);
    ctx.scale(facing, 1);

    // legs
    ctx.fillStyle = COLORS.pants;
    ctx.fillRect(-8, 14, 6, 12);
    ctx.fillRect(2, 14, 6, 12);

    // torso
    ctx.fillStyle = COLORS.shirt;
    ctx.fillRect(-9, -4, 18, 20);

    // tie
    ctx.fillStyle = COLORS.tie;
    ctx.fillRect(-2, -3, 4, 12);

    // arms
    ctx.fillStyle = COLORS.shirt;
    ctx.fillRect(-13, -2, 5, 12);
    ctx.fillRect(8, -2, 5, 12);

    // head
    ctx.fillStyle = COLORS.skin;
    ctx.fillRect(-8, -20, 16, 16);

    // hair
    ctx.fillStyle = COLORS.hair;
    ctx.fillRect(-8, -22, 16, 5);

    // eye
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(4, -13, 2, 2);

    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shake > 0) {
      const sx = (Math.random() - 0.5) * 6 * shake;
      const sy = (Math.random() - 0.5) * 6 * shake;
      ctx.translate(sx, sy);
    }

    drawBackground();

    const lo = Math.max(0, currentIndex - 2);
    const hi = Math.min(steps.length - 1, currentIndex + 14);
    for (let i = lo; i <= hi; i++) drawStep(steps[i]);

    drawCharacter();

    ctx.restore();
  }

  // ---------- Main loop ----------
  function loop(now) {
    if (!lastTime) lastTime = now;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    update(dt);
    render();

    requestAnimationFrame(loop);
  }

  resetGame();
  requestAnimationFrame(loop);
})();
