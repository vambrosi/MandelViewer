// ------------------------------------------------------------------------------------- //
// Globals
// ------------------------------------------------------------------------------------- //

function $id(element) { return document.getElementById(element) }

const WASM_PAGE_SIZE = 1024 * 64;
const PALETTE_PAGES = 2;
const CANVAS_SIZE = 500;

const MAX_PPU = 1e16;
const MIN_PPU = CANVAS_SIZE / 4;
const MAX_ITERS = 500;

const mandelCanvas = $id("mandelCanvas");
const juliaCanvas = $id("juliaCanvas");

let juliaC = [0.0, 0.0];

// ------------------------------------------------------------------------------------- //
// Plots
// ------------------------------------------------------------------------------------- //

class View {
    // View parameters
    center
    init_center
    ppu
    init_ppu
    isMandel

    // Canvas variables
    canvas
    ctx
    img

    // Mouse coordinates
    pointerCanvas
    pointerComplex
    pointerSpanX
    pointerSpanY
    pointerOn

    // Drag parameters
    dragged
    dragStartCanvas
    dragStartComplex
    translationCanvas
    translationComplex

    // Wasm functions and memory
    wasmMem
    wasmMem8
    wasmShared
    wasmObj

    constructor(canvas, center, diameter, isMandel, spanX, spanY) {
        this.center = [...center];
        this.init_center = [...center];
        this.ppu = CANVAS_SIZE / diameter;
        this.init_ppu = CANVAS_SIZE / diameter;
        this.canvas = canvas;
        this.isMandel = isMandel;

        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;

        this.ctx = canvas.getContext("2d");
        this.img = this.ctx.createImageData(canvas.width, canvas.height);
        const pages = Math.ceil(this.img.data.length / WASM_PAGE_SIZE);

        this.wasmMem = new WebAssembly.Memory({ initial: pages + PALETTE_PAGES });
        this.wasmMem8 = new Uint8ClampedArray(this.wasmMem.buffer);
        this.wasmShared = {
            math: { log2: Math.log2 },
            js: {
                shared_mem: this.wasmMem,
                image_offset: 0,
                palette_offset: WASM_PAGE_SIZE * pages
            }
        };

        this.dragged = false;
        this.pointerOn = false;
        this.pointerSpanX = spanX;
        this.pointerSpanY = spanY;
        this.canvas.addEventListener("mousemove", this.mouseTrack(this), false);
        this.canvas.addEventListener("mousedown", this.dragHandler(this), false);
        this.canvas.addEventListener("mouseover", (e) => { this.pointerOn = true; }, false)
        this.canvas.addEventListener("mouseout", (e) => { this.pointerOn = false; }, false)
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
                CANVAS_SIZE, CANVAS_SIZE, this.center[0], this.center[1], this.ppu, MAX_ITERS
            );
        } else {
            this.wasmObj.instance.exports.julia_plot(
                CANVAS_SIZE, CANVAS_SIZE, this.center[0], this.center[1], this.ppu, MAX_ITERS, juliaC[0], juliaC[1]
            );
        }
        this.img.data.set(this.wasmMem8.slice(0, this.img.data.length));
        this.redraw();
    }

    redraw(corner=[0, 0]) {
        this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        this.ctx.putImageData(this.img, corner[0], corner[1]);

        if (!this.isMandel) { return };

        const circle = new Path2D();
        const c = addVector(corner, this.complexToCanvas(juliaC));
        circle.arc(c[0], c[1], 4, 0, 2 * Math.PI);

        this.ctx.fillStyle = "red";
        this.ctx.fill(circle);
    }

    // Coordinate changes

    canvasToComplex(point) {
        const real = this.center[0] + (point[0] - CANVAS_SIZE / 2) / this.ppu;
        const imag = this.center[1] - (point[1] - CANVAS_SIZE / 2) / this.ppu;
        return [real, imag]
    }

    complexToCanvas(z) {
        const x = CANVAS_SIZE / 2 + this.ppu * (z[0] - this.center[0]);
        const y = CANVAS_SIZE / 2 - this.ppu * (z[1] - this.center[1]);
        return [x, y]
    }

    // Event handlers

    mouseTrack(view) {
        return (event) => {
            view.pointerCanvas = eventClampedPos(event);
            view.pointerComplex = view.canvasToComplex(view.pointerCanvas);

            view.pointerSpanX.innerHTML = Number.parseFloat(view.pointerComplex[0]).toFixed(16);
            view.pointerSpanY.innerHTML = Number.parseFloat(view.pointerComplex[1]).toFixed(16);

            if (view.dragStartCanvas) {
                view.dragged = true;
                view.translationCanvas = subVector(view.pointerCanvas, view.dragStartCanvas);
                view.translationComplex = subVector(view.dragStartComplex, view.pointerComplex);

                view.redraw(view.translationCanvas);
            }
        }
    }

    dragHandler(view) {
        return (event) => {
            if (event.button == 0) {
                view.dragStartCanvas = eventClampedPos(event);
                view.dragStartComplex = view.canvasToComplex(view.dragStartCanvas);
                view.dragged = false;
            }
        }
    }
}

const mandelView = new View($id("mandelCanvas"), [-0.5, 0.0], 4.0, true, $id("mandelX"), $id("mandelY"));
const juliaView = new View($id("juliaCanvas"), [0.0, 0.0], 4.0, false, $id("juliaX"), $id("juliaY"));

document.addEventListener("mouseup", dragHandler, false);
document.addEventListener("keydown", keyHandler, false);

// mandelView.canvas.addEventListener("click", (e) => {
//     juliaC = mandelView.canvasToComplex(eventClampedPos(e));
//     mandelView.redraw([0, 0]);
//     juliaView.update();
// }, false);

mandelView.initialize();
juliaView.initialize();

// ------------------------------------------------------------------------------------- //
// Event Listeners
// ------------------------------------------------------------------------------------- //

const offsetToClampedPos = (offset, dim, offsetDim) => {
    let pos = offset - ((offsetDim - dim) /  2);
    return pos < 0 ? 0 : pos > dim ? dim : pos
}

const eventClampedPos = (event) => {
    const x = offsetToClampedPos(event.offsetX, event.target.width, event.target.offsetWidth);
    const y = offsetToClampedPos(event.offsetY, event.target.height, event.target.offsetHeight);
    return [x, y]
}

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
    if (event.key == "c" && mandelView.pointerOn) {
        juliaC = mandelView.pointerComplex;
        juliaView.update();
        mandelView.redraw();
    }

    const view = mandelView.pointerOn ? mandelView : juliaView.pointerOn ? juliaView : null;
    if (!view) { return }

    if (event.key == "r") {
        view.center = [...view.init_center];
        view.ppu = view.init_ppu;
        view.update();

    } else if (event.key == "z") {
        view.center = midpoint(view.center, view.pointerComplex);
        view.ppu *= 2.0;
        view.ppu = view.ppu > MAX_PPU ? MAX_PPU : view.ppu;
        view.update();

    } else if (event.key == "x") {
        view.center = subVector(multVector(2, view.center), view.pointerComplex);
        view.ppu /= 2.0;
        view.update();
    }
}

// ------------------------------------------------------------------------------------- //
// Vector Operations
// ------------------------------------------------------------------------------------- //

function addVector(v1, v2) {
    return v1.map((e, i) => e + v2[i])
}

function subVector(v1, v2) {
    return v1.map((e, i) => e - v2[i])
}

function multVector(c, v) {
    return v.map((e, i) => c * e)
}

function distance(v1, v2) {
    return Math.sqrt((v1[0] - v2[0]) ** 2 + (v1[1] - v2[1]) ** 2)
}

function midpoint(v1, v2) {
    return multVector(0.5, addVector(v1, v2))
}