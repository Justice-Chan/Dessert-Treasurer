// Decorative art. Everything drawn here is also available as text on the page,
// so it is hidden from assistive technology.

const cakeGlyphs = ["░", "▒", "▓", "█", "#"];
const sampleLayers = [{ label: "", amount: 2 }, { label: "", amount: 5 }, { label: "", amount: 9 }];
const maxLayers = 5;

// Largest categories become cake layers, smallest on top; width follows the amount.
function cakeLayers(items) {
  const layers = items.filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, maxLayers).reverse();
  const largest = Math.max(...layers.map((layer) => layer.amount), 1);
  return layers.map((layer, index) => ({ ...layer, index, share: Math.sqrt(layer.amount / largest) }));
}

function asciiCake(layers) {
  const widths = layers.map((layer) => 7 + 2 * Math.round(layer.share * 10));
  const total = Math.max(...widths) + 6;
  const center = (line) => " ".repeat(Math.floor((total - line.length) / 2)) + line;
  const lines = [center("."), center("|")];
  layers.forEach((layer, index) => {
    const fill = cakeGlyphs[layer.index % cakeGlyphs.length].repeat(widths[index]);
    lines.push(center(`.${"-".repeat(widths[index])}.`), center(`|${fill}|`), center(`|${fill}|`));
  });
  lines.push(center(`'${"-".repeat(widths[widths.length - 1])}'`), "=".repeat(total));
  return lines.join("\n");
}

function blockCake(layers) {
  const cake = document.createElement("div");
  cake.className = "block-cake";
  const cherry = document.createElement("span");
  cherry.className = "cherry";
  cake.append(cherry);
  layers.forEach((layer) => {
    const block = document.createElement("span");
    block.className = `layer layer-${layer.index % maxLayers}`;
    block.style.width = `${Math.round(30 + layer.share * 70)}%`;
    cake.append(block);
  });
  return cake;
}

// Scatters dots over the landing page; each gets its own size, pace and starting point.
function renderMotes(container, count = 18) {
  container.replaceChildren(...Array.from({ length: count }, () => {
    const mote = document.createElement("span");
    const size = 3 + Math.random() * 9;
    const duration = 14 + Math.random() * 16;
    mote.className = "mote";
    mote.style.cssText = [
      `left: ${(Math.random() * 100).toFixed(1)}%`,
      `top: ${(20 + Math.random() * 80).toFixed(1)}%`,
      `width: ${size.toFixed(1)}px`,
      `height: ${size.toFixed(1)}px`,
      `--peak: ${(0.18 + Math.random() * 0.4).toFixed(2)}`,
      `--sway: ${Math.round((Math.random() - 0.5) * 80)}px`,
      `animation-duration: ${duration.toFixed(1)}s`,
      `animation-delay: -${(Math.random() * duration).toFixed(1)}s`
    ].join("; ");
    return mote;
  }));
}

// Landing page art: a turning cake and a floating cookie, ray-marched into text.
let dessertScene = null;

function renderLandingArt(container, theme) {
  if (!dessertScene) {
    const pre = document.createElement("pre");
    pre.className = "ascii-scene";
    container.replaceChildren(pre);
    dessertScene = startDessertScene(pre);
  }
  dessertScene.setInverted(theme === "cake");
}

function startDessertScene(pre) {
  const cols = 76;
  const rows = 23;
  const ramp = ".:-=+*#%@";
  const cell = 3.3 / cols;          // world units per column
  const rowStep = cell / 0.6;       // characters are taller than they are wide
  const pitch = 0.38;
  const forward = [0, -Math.sin(pitch), -Math.cos(pitch)];
  const up = [0, Math.cos(pitch), -Math.sin(pitch)];
  const light = [-0.47, 0.75, 0.47];
  const wedgeCos = Math.cos(0.4);
  const wedgeSin = Math.sin(0.4);
  const sector = Math.PI / 4;
  const chips = [[0, 0], [0.2, 0.12], [-0.18, 0.16], [-0.1, -0.22], [0.17, -0.17]];
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let inverted = false;
  let spinCos = 1, spinSin = 0;
  let cookie = { y: 0, e1: [1, 0, 0], axis: [0, 0, 1], e2: [0, 1, 0], cos: 1, sin: 0 };
  let dCake = 0, dDollop = 0, dCherry = 0, dCookie = 0;
  let cakeX = 0, cakeZ = 0, wedge = 0, cookieX = 0, cookieY = 0, cookieZ = 0;
  let last = 0;

  const tier = (radial, y, radius, centre, half) => {
    const dx = radial - radius + 0.03;
    const dy = Math.abs(y - centre) - half + 0.03;
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - 0.03;
  };

  // Distance to the nearest surface; also records each part's distance for shading.
  function distance(x, y, z) {
    cakeX = (x - 0.4) * spinCos + z * spinSin;
    cakeZ = -(x - 0.4) * spinSin + z * spinCos;
    const radial = Math.hypot(cakeX, cakeZ);
    wedge = Math.abs(cakeZ) * wedgeCos - cakeX * wedgeSin;
    dCake = Math.max(Math.min(tier(radial, y, 0.95, -0.3, 0.25), tier(radial, y, 0.6, 0.175, 0.225)), -wedge);
    const angle = Math.atan2(cakeZ, cakeX);
    const folded = angle - sector * Math.round(angle / sector);
    dDollop = Math.max(Math.hypot(radial * Math.cos(folded) - 0.78, y, radial * Math.sin(folded)) - 0.1, -wedge);
    dCherry = Math.hypot(cakeX + 0.25, y - 0.5, cakeZ) - 0.13;
    const qx = x + 1.2, qy = y - cookie.y, qz = z - 0.3;
    const lx = qx * cookie.e1[0] + qy * cookie.e1[1] + qz * cookie.e1[2];
    const lz = qx * cookie.e2[0] + qy * cookie.e2[1] + qz * cookie.e2[2];
    cookieY = qx * cookie.axis[0] + qy * cookie.axis[1] + qz * cookie.axis[2];
    cookieX = lx * cookie.cos + lz * cookie.sin;
    cookieZ = -lx * cookie.sin + lz * cookie.cos;
    dCookie = tier(Math.hypot(lx, lz), cookieY, 0.42, 0, 0.07);
    return Math.min(dCake, dDollop, dCherry, dCookie);
  }

  // How bright each material is before lighting.
  function tone(y, normalY) {
    const nearest = Math.min(dCake, dDollop, dCherry, dCookie);
    if (nearest === dCherry) return 0.6;
    if (nearest === dDollop) return 0.85;
    if (nearest === dCookie) {
      const onChip = cookieY > 0 && chips.some(([cx, cz]) => Math.hypot(cookieX - cx, cookieZ - cz) < 0.07);
      return onChip ? 0.12 : 0.75;
    }
    if (wedge < 0.03) return Math.sin(y * 42) > 0 ? 0.85 : 0.35;      // layers on the cut faces
    if (normalY > 0.7) return 1;                                      // frosting on top
    return Math.abs(y + 0.3) < 0.045 || Math.abs(y - 0.175) < 0.04 ? 0.2 : 0.5;
  }

  function draw(seconds) {
    spinCos = Math.cos(seconds * 0.45);
    spinSin = Math.sin(seconds * 0.45);
    const sway = 0.5 * Math.sin(seconds * 0.8);
    const lean = pitch + 0.25 + 0.2 * Math.sin(seconds * 0.6);
    const axis = [Math.sin(sway) * Math.cos(lean), Math.sin(lean), Math.cos(sway) * Math.cos(lean)];
    const e1 = [axis[2], 0, -axis[0]];
    const length = Math.hypot(e1[0], e1[2]);
    e1[0] /= length; e1[2] /= length;
    const e2 = [axis[1] * e1[2], axis[2] * e1[0] - axis[0] * e1[2], -axis[1] * e1[0]];
    cookie = { y: 0.3 + 0.09 * Math.sin(seconds * 1.3), e1, axis, e2, cos: Math.cos(seconds * 0.5), sin: Math.sin(seconds * 0.5) };

    const lines = [];
    for (let row = 0; row < rows; row += 1) {
      const v = (rows / 2 - row - 0.5) * rowStep - 0.08;
      let line = "";
      for (let col = 0; col < cols; col += 1) {
        const ox = (col - cols / 2 + 0.5) * cell - 0.25;
        const oy = v * up[1] - forward[1] * 5;
        const oz = v * up[2] - forward[2] * 5;
        let travelled = 2.5;
        let hit = false;
        for (let step = 0; step < 56 && travelled < 8; step += 1) {
          const d = distance(ox, oy + forward[1] * travelled, oz + forward[2] * travelled);
          if (d < 0.012) { hit = true; break; }
          travelled += d;
        }
        if (!hit) { line += " "; continue; }
        const x = ox, y = oy + forward[1] * travelled, z = oz + forward[2] * travelled;
        const e = 0.01;
        const nx = distance(x + e, y, z) - distance(x - e, y, z);
        const ny = distance(x, y + e, z) - distance(x, y - e, z);
        const nz = distance(x, y, z + e) - distance(x, y, z - e);
        const size = Math.hypot(nx, ny, nz) || 1;
        distance(x, y, z);
        const lit = Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / size);
        const level = Math.min(1, tone(y, ny / size) * (0.25 + 0.75 * lit));
        const index = Math.round((inverted ? 1 - level : level) * (ramp.length - 1));
        line += ramp[index];
      }
      lines.push(line);
    }
    pre.textContent = lines.join("\n");
  }

  function tick(time) {
    const visible = !document.hidden && pre.offsetParent !== null;
    if (visible && time - last > 80) {
      last = time;
      draw(time / 1000);
    }
    requestAnimationFrame(tick);
  }

  draw(0);
  if (!still) requestAnimationFrame(tick);

  return {
    setInverted(value) {
      inverted = value;
      if (still) draw(0);
    }
  };
}

function renderCake(container, items, theme) {
  const layers = cakeLayers(items.length ? items : sampleLayers);
  if (theme === "cake") {
    container.replaceChildren(blockCake(layers));
    return layers;
  }
  const pre = document.createElement("pre");
  pre.textContent = asciiCake(layers);
  container.replaceChildren(pre);
  return layers;
}

// Slow field of ledger glyphs, denser toward the bottom of the screen.
function startGlyphField(canvas) {
  const context = canvas.getContext("2d");
  const glyphs = "0123456789$[]{}&+%".split("");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let particles = [];
  let width = 0;
  let height = 0;
  let color = "233, 166, 80";
  let previous = 0;
  let frame = 0;

  const spawn = (anywhere) => ({
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : height + 24,
    speed: 4 + Math.random() * 10,
    drift: (Math.random() - 0.5) * 4,
    size: 11 + Math.random() * 10,
    alpha: 0.1 + Math.random() * 0.35,
    glyph: glyphs[Math.floor(Math.random() * glyphs.length)]
  });

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = Array.from({ length: Math.min(90, Math.round((width * height) / 14000)) }, () => spawn(true));
    draw(0);
  }

  function draw(seconds) {
    context.clearRect(0, 0, width, height);
    context.textAlign = "center";
    particles.forEach((particle, index) => {
      particle.y -= particle.speed * seconds;
      particle.x += particle.drift * seconds;
      if (particle.y < -24) particles[index] = spawn(false);
      const depth = Math.max(0, particle.y / height);
      context.font = `${particle.size}px ui-monospace, Menlo, Consolas, monospace`;
      context.fillStyle = `rgba(${color}, ${(particle.alpha * depth * depth).toFixed(3)})`;
      context.fillText(particle.glyph, particle.x, particle.y);
    });
  }

  function tick(time) {
    const visible = !document.hidden && getComputedStyle(canvas).display !== "none";
    if (visible) draw(Math.min(0.1, (time - previous) / 1000));
    previous = time;
    frame = requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize);
  resize();
  if (!still) frame = requestAnimationFrame(tick);

  return {
    recolor() {
      color = getComputedStyle(document.documentElement).getPropertyValue("--glyph").trim() || color;
      draw(0);
    },
    stop() { cancelAnimationFrame(frame); }
  };
}
