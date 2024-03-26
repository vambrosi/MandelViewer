// ------------------------------------------------------------------------------------- //
// Globals
// ------------------------------------------------------------------------------------- //

function $id(element) {
  return document.getElementById(element);
}

const WASM_PAGE_SIZE = 1024 * 64;
const PALETTE_PAGES = 2;
const CANVAS_SIZE = 500;

let maxIters = 100;

const mandelCanvas = $id("mandelCanvas");
const juliaCanvas = $id("juliaCanvas");

let juliaC = [0.0, 0.0];
let orbitStart = [0.0, 0.0];
let orbitLength = 8;

// ------------------------------------------------------------------------------------- //
// Plots
// ------------------------------------------------------------------------------------- //

class View {
  // View parameters
  center;
  init_center;
  ppu;
  init_ppu;
  isMandel;

  // Canvas variables
  canvas;
  ctx;
  img;

  // Buffer canvas
  bufferCanvas;
  bufferCtx;

  // Mouse coordinates
  pointerCanvas;
  pointerComplex;
  pointerSpanX;
  pointerSpanY;
  pointerOn;
  scale;
  isZooming;

  // Drag parameters
  dragged;
  dragStartCanvas;
  dragStartComplex;
  translationCanvas;
  translationComplex;

  // Wasm functions and memory
  wasmMem;
  wasmMem8;
  wasmShared;
  wasmObj;

  constructor(canvas, center, diameter, isMandel, spanX, spanY) {
    this.center = [...center];
    this.init_center = [...center];
    this.ppu = CANVAS_SIZE / diameter;
    this.init_ppu = CANVAS_SIZE / diameter;
    this.canvas = canvas;
    this.isMandel = isMandel;
    this.scale = 1;
    this.isZooming = false;

    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    this.ctx = canvas.getContext("2d");
    // this.img = this.ctx.createImageData(canvas.width, canvas.height);

    this.bufferCanvas = document.createElement("canvas");
    this.bufferCanvas.width = canvas.width;
    this.bufferCanvas.height = canvas.height;
    this.bufferCtx = this.bufferCanvas.getContext("2d");
    this.img = this.bufferCtx.createImageData(canvas.width, canvas.height);
    const pages = Math.ceil(this.img.data.length / WASM_PAGE_SIZE);

    this.wasmMem = new WebAssembly.Memory({ initial: pages + PALETTE_PAGES });
    this.wasmMem8 = new Uint8ClampedArray(this.wasmMem.buffer);
    this.wasmShared = {
      math: { log2: Math.log2 },
      js: {
        shared_mem: this.wasmMem,
        image_offset: 0,
        palette_offset: WASM_PAGE_SIZE * pages,
      },
    };

    this.dragged = false;
    this.pointerOn = false;
    this.pointerSpanX = spanX;
    this.pointerSpanY = spanY;
    this.canvas.addEventListener("mousemove", this.mouseTrack(this), false);
    this.canvas.addEventListener("mousedown", this.dragHandler(this), false);
    this.canvas.addEventListener(
      "mouseover",
      (e) => {
        this.pointerOn = true;
      },
      false
    );
    this.canvas.addEventListener(
      "mouseout",
      (e) => {
        this.pointerOn = false;
      },
      false
    );
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();

        this.scale += e.deltaY * -0.01;
        this.scale = Math.min(Math.max(0.02, this.scale), 50);
        this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        this.ctx.translate(this.pointerCanvas[0], this.pointerCanvas[1]);
        this.ctx.scale(this.scale, this.scale);
        this.ctx.translate(-this.pointerCanvas[0], -this.pointerCanvas[1]);
        this.redraw();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        window.clearTimeout(this.isZooming);

        this.isZooming = setTimeout(() => {
          this.ppu *= this.scale;
          this.center = addVector(
            multVector(1 / this.scale, this.center),
            multVector(1 - 1 / this.scale, this.pointerComplex)
          );

          this.update();
          this.scale = 1;
        }, 100);
      },
      false
    );
  }

  // Plotting functions

  async initialize() {
    this.wasmObj = await WebAssembly.instantiateStreaming(
      fetch("./wat/plot.wasm"),
      this.wasmShared
    );
    this.wasmObj.instance.exports.gen_palette();
    this.update();
  }

  update() {
    if (this.isMandel) {
      this.wasmObj.instance.exports.mandel_plot(
        CANVAS_SIZE,
        CANVAS_SIZE,
        this.center[0],
        this.center[1],
        this.ppu,
        maxIters
      );
    } else {
      this.wasmObj.instance.exports.julia_plot(
        CANVAS_SIZE,
        CANVAS_SIZE,
        this.center[0],
        this.center[1],
        this.ppu,
        maxIters,
        juliaC[0],
        juliaC[1]
      );
    }
    this.img.data.set(this.wasmMem8.slice(0, this.img.data.length));
    this.redraw();
  }

  redraw(corner = [0, 0]) {
    this.bufferCtx.putImageData(this.img, 0, 0);

    if (this.isMandel) {
      const circle = new Path2D();
      const c = this.complexToCanvas(juliaC);
      circle.arc(c[0], c[1], 4, 0, 2 * Math.PI);

      this.bufferCtx.fillStyle = "red";
      this.bufferCtx.fill(circle);
    } else {
      plotArray(this, iterate(orbitStart, orbitLength - 1));
    }
    this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    this.ctx.drawImage(this.bufferCanvas, corner[0], corner[1]);
  }

  // Coordinate changes

  canvasToComplex(point) {
    const real = this.center[0] + (point[0] - CANVAS_SIZE / 2) / this.ppu;
    const imag = this.center[1] - (point[1] - CANVAS_SIZE / 2) / this.ppu;
    return [real, imag];
  }

  complexToCanvas(z) {
    const x = CANVAS_SIZE / 2 + this.ppu * (z[0] - this.center[0]);
    const y = CANVAS_SIZE / 2 - this.ppu * (z[1] - this.center[1]);
    return [x, y];
  }

  // Event handlers

  mouseTrack(view) {
    return (event) => {
      view.pointerCanvas = eventClampedPos(event);
      view.pointerComplex = view.canvasToComplex(view.pointerCanvas);

      view.pointerSpanX.innerHTML = Number.parseFloat(
        view.pointerComplex[0]
      ).toFixed(16);
      view.pointerSpanY.innerHTML = Number.parseFloat(
        view.pointerComplex[1]
      ).toFixed(16);

      if (view.dragStartCanvas) {
        view.dragged = true;
        view.translationCanvas = subVector(
          view.pointerCanvas,
          view.dragStartCanvas
        );
        view.translationComplex = subVector(
          view.dragStartComplex,
          view.pointerComplex
        );

        view.redraw(view.translationCanvas);
      }
    };
  }

  dragHandler(view) {
    return (event) => {
      if (event.button == 0) {
        view.dragStartCanvas = eventClampedPos(event);
        view.dragStartComplex = view.canvasToComplex(view.dragStartCanvas);
        view.dragged = false;
      }
    };
  }
}

const mandelView = new View(
  $id("mandelCanvas"),
  [-0.5, 0.0],
  4.0,
  true,
  $id("mandelX"),
  $id("mandelY")
);
const juliaView = new View(
  $id("juliaCanvas"),
  [0.0, 0.0],
  4.0,
  false,
  $id("juliaX"),
  $id("juliaY")
);

document.addEventListener("mouseup", dragHandler, false);
document.addEventListener("keydown", keyHandler, false);

mandelView.initialize();
juliaView.initialize();

// ------------------------------------------------------------------------------------- //
// Event Listeners
// ------------------------------------------------------------------------------------- //

const offsetToClampedPos = (offset, dim, offsetDim) => {
  let pos = offset - (offsetDim - dim) / 2;
  return pos < 0 ? 0 : pos > dim ? dim : pos;
};

const eventClampedPos = (event) => {
  const x = offsetToClampedPos(
    event.offsetX,
    event.target.width,
    event.target.offsetWidth
  );
  const y = offsetToClampedPos(
    event.offsetY,
    event.target.height,
    event.target.offsetHeight
  );
  return [x, y];
};

function dragHandler(event) {
  if (event.button == 0) {
    for (let view of [mandelView, juliaView]) {
      if (view.dragged) {
        view.center = addVector(view.center, view.translationComplex);
        view.update();
      }

      view.dragStartCanvas = null;
      view.dragStartComplex = null;
      view.dragged = false;
    }
  }
}

function keyHandler(event) {
  switch (event.key) {
    case "c":
      if (mandelView.pointerOn) {
        juliaC = mandelView.pointerComplex;
        juliaView.update();
        mandelView.redraw();
      } else if (juliaView.pointerOn) {
        orbitStart = juliaView.pointerComplex;
        juliaView.redraw();
      }
      break;
    case "ArrowUp":
      orbitLengthInput.blur();
      orbitLength = orbitLength > 1000 ? 1000 : orbitLength + 1;
      orbitLengthInput.value = orbitLength;
      juliaView.redraw();
      break;
    case "ArrowDown":
      orbitLengthInput.blur();
      orbitLength = orbitLength <= 2 ? 1 : orbitLength - 1;
      orbitLengthInput.value = orbitLength;
      juliaView.redraw();
      break;
  }

  const view = mandelView.pointerOn
    ? mandelView
    : juliaView.pointerOn
    ? juliaView
    : null;
  if (!view) {
    return;
  }
  orbitLengthInput.blur();
  maxItersInput.blur();

  if (event.key == "r") {
    view.center = [...view.init_center];
    view.ppu = view.init_ppu;
    view.update();
  }

  if (
    event.key == "r" ||
    event.key == "c" ||
    event.key == "ArrowUp" ||
    event.key == "ArrowDown"
  ) {
    event.preventDefault();
  }
}

// ------------------------------------------------------------------------------------- //
// Vector Operations
// ------------------------------------------------------------------------------------- //

function addVector(v1, v2) {
  return v1.map((e, i) => e + v2[i]);
}

function subVector(v1, v2) {
  return v1.map((e, i) => e - v2[i]);
}

function multVector(c, v) {
  return v.map((e, i) => c * e);
}

function distance(v1, v2) {
  return Math.sqrt((v1[0] - v2[0]) ** 2 + (v1[1] - v2[1]) ** 2);
}

function midpoint(v1, v2) {
  return multVector(0.5, addVector(v1, v2));
}

// ------------------------------------------------------------------------------------- //
// Auxiliary Functions
// ------------------------------------------------------------------------------------- //

function iterate(z, iterates) {
  orbit = [z];

  let x = z[0];
  let y = z[1];

  let x2 = x * x;
  let y2 = y * y;

  for (let i = 0; i < iterates; i++) {
    y = 2 * x * y + juliaC[1];
    x = x2 - y2 + juliaC[0];

    orbit.push([x, y]);
    x2 = x * x;
    y2 = y * y;
  }
  return orbit;
}

function plotArray(view, zs) {
  view.bufferCtx.strokeStyle = "red";
  view.bufferCtx.fillStyle = "red";
  view.bufferCtx.beginPath();

  let zCanvas = view.complexToCanvas(zs[0]);
  view.bufferCtx.moveTo(zCanvas[0], zCanvas[1]);

  let circle = new Path2D();
  circle.arc(zCanvas[0], zCanvas[1], 5, 0, 2 * Math.PI);
  view.bufferCtx.fill(circle);

  for (let i = 1; i < zs.length; i++) {
    zCanvas = view.complexToCanvas(zs[i]);
    view.bufferCtx.lineTo(zCanvas[0], zCanvas[1]);

    circle = new Path2D();
    circle.arc(zCanvas[0], zCanvas[1], 5, 0, 2 * Math.PI);
    view.bufferCtx.fill(circle);
  }

  view.bufferCtx.stroke();
}

// ------------------------------------------------------------------------------------- //
// Menu Functions
// ------------------------------------------------------------------------------------- //

const menu = document.querySelector(".menu");
const menuItems = document.querySelectorAll(".menuItem");
const hamburger = document.querySelector(".hamburger");
const closeIcon = document.querySelector(".closeIcon");
const menuIcon = document.querySelector(".menuIcon");

function toggleMenu() {
  if (menu.classList.contains("showMenu")) {
    menu.classList.remove("showMenu");
    closeIcon.style.display = "none";
    menuIcon.style.display = "block";
  } else {
    menu.classList.add("showMenu");
    closeIcon.style.display = "block";
    menuIcon.style.display = "none";
  }
}

hamburger.addEventListener("click", toggleMenu);

const orbitLengthInput = $id("orbitLength");
const maxItersInput = $id("maxIters");

orbitLengthInput.value = orbitLength;
maxItersInput.value = maxIters;

orbitLengthInput.addEventListener("input", updateOrbitLength);
orbitLengthInput.addEventListener("keydown", updateOrbitLength);
maxItersInput.addEventListener("input", updateMaxIters);
maxItersInput.addEventListener("keydown", updateMaxIters);

let isTyping = false;

function updateMaxIters(event) {
  maxIters = Number.parseInt(maxItersInput.value);

  window.clearTimeout(isTyping);

  isTyping = setTimeout(() => {
    mandelView.update();
    juliaView.update();

    if (event.key == "Enter") {
      focus(mandelCanvas);
      toggleMenu();
    }
  }, 200);
}

function updateOrbitLength(event) {
  orbitLength = Number.parseInt(orbitLengthInput.value);
  juliaView.redraw();

  if (event.key == "Enter") {
    focus(mandelCanvas);
    toggleMenu();
  }
}
