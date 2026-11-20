/*
 * The Model Extractor's preview: a decoded model (OsrsModel.decode, the client's decoder) drawn
 * with WebGL. Drag to rotate, scroll to zoom, double-click to reset. Faces have their own colours
 * with simple lighting; textured faces show their base colour (textures aren't loaded). Faces the
 * game hides are hidden, as the client's ModelData.light does: alpha -1 or render type 2, and
 * textured faces whose render type isn't 0. Render type 3 is drawn black.
 */
(function () {
  "use strict";

  const HUE_OFFSET = 0.0078125;
  const SATURATION_OFFSET = 0.0625;
  /** ColorUtil.BRIGHTNESS_LOW, the client's palette brightness. */
  const BRIGHTNESS = 0.8;
  /** The view a model starts from: turned a little to the side, seen a little from above. */
  const DEFAULT_VIEW = { yaw: -0.6, pitch: 0.35, zoom: 1 };

  /** An OSRS 16-bit HSL colour as [r, g, b] in 0..1 (client ColorUtil.hslToRgb and its palette). */
  function hslToRgb(hsl) {
    const hue = ((hsl >> 10) & 63) / 64 + HUE_OFFSET;
    const saturation = ((hsl >> 7) & 7) / 8 + SATURATION_OFFSET;
    const luminance = (hsl & 127) / 128;
    const q = luminance < 0.5 ? luminance * (1 + saturation) : luminance + saturation - luminance * saturation;
    const p = 2 * luminance - q;
    const channel = (t) => {
      if (t > 1) t -= 1;
      if (t < 0) t += 1;
      if (6 * t < 1) return p + (q - p) * 6 * t;
      if (2 * t < 1) return q;
      if (3 * t < 2) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)].map((value) => Math.pow(Math.min(1, Math.max(0, value)), BRIGHTNESS));
  }

  /** An OSRS 16-bit HSL colour as the `#rrggbb` the preview gives it, before lighting. */
  function hslToHex(hsl) {
    return "#" + hslToRgb(hsl & 0xffff).map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("");
  }

  /** Triangles for WebGL, one vertex copy per face corner (flat normals): opaque and see-through apart. */
  function buildMesh(model, recolours) {
    const swap = new Map((recolours ?? []).map(([from, to]) => [from & 0xffff, to & 0xffff]));
    const opaque = { positions: [], normals: [], colors: [] };
    const clear = { positions: [], normals: [], colors: [] };
    let shown = 0;
    /** Drawn faces per colour stored in the file (render type 3 faces are black and not counted). */
    const colourFaces = new Map();
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    // OSRS y points down; flip it so the model stands upright.
    const point = (index) => [model.x[index], -model.y[index], model.z[index]];
    for (let face = 0; face < model.faceCount; face++) {
      const alphaByte = model.alphas ? model.alphas[face] : 0;
      let type = model.renderTypes ? model.renderTypes[face] : 0;
      const texture = model.textures ? model.textures[face] : -1;
      if (alphaByte === -2) type = 3;
      if (alphaByte === -1) type = 2;
      if (type === 2 || (texture !== -1 && type !== 0)) continue;
      const corners = [point(model.a[face]), point(model.b[face]), point(model.c[face])];
      if (corners.some((corner) => corner.some((value) => value === undefined))) continue;
      const u = [0, 1, 2].map((axis) => corners[1][axis] - corners[0][axis]);
      const v = [0, 1, 2].map((axis) => corners[2][axis] - corners[0][axis]);
      // OSRS faces wind the other way once y is flipped: this normal points out of the model.
      let normal = [u[2] * v[1] - u[1] * v[2], u[0] * v[2] - u[2] * v[0], u[1] * v[0] - u[0] * v[1]];
      const length = Math.hypot(...normal) || 1;
      normal = normal.map((value) => value / length);
      const raw = model.colors[face] & 0xffff;
      const rgb = type === 3 ? [0, 0, 0] : hslToRgb(swap.get(raw) ?? raw);
      if (type !== 3) colourFaces.set(raw, (colourFaces.get(raw) ?? 0) + 1);
      const alpha = 1 - (alphaByte & 0xff) / 255;
      const target = alpha < 0.999 ? clear : opaque;
      for (const corner of corners) {
        target.positions.push(...corner);
        target.normals.push(...normal);
        target.colors.push(...rgb, alpha);
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], corner[axis]);
          max[axis] = Math.max(max[axis], corner[axis]);
        }
      }
      shown++;
    }
    if (!shown) { min = [0, 0, 0]; max = [0, 0, 0]; }
    const center = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2);
    const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    return { opaque, clear, shown, hidden: model.faceCount - shown, colourFaces, center, radius, size: [0, 1, 2].map((axis) => max[axis] - min[axis]) };
  }

  /**
   * Triangles for a lit, posed body (the client's Model, from OsrsModel.buildBody/pose): each
   * corner has the colour the client lit it with (HSL in the low 16 bits), so nothing is lit here.
   * faceColors3 -2 hides a face, -1 colours it flat with faceColors1.
   */
  function buildLitMesh(model) {
    const opaque = { positions: [], normals: [], colors: [] };
    const clear = { positions: [], normals: [], colors: [] };
    let shown = 0;
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    const point = (index) => [model.verticesX[index], -model.verticesY[index], model.verticesZ[index]];
    for (let face = 0; face < model.faceCount; face++) {
      const third = model.faceColors3[face];
      if (third === -2) continue;
      const corners = [point(model.indices1[face]), point(model.indices2[face]), point(model.indices3[face])];
      if (corners.some((corner) => corner.some((value) => value === undefined || Number.isNaN(value)))) continue;
      const colours = third === -1
        ? [model.faceColors1[face], model.faceColors1[face], model.faceColors1[face]]
        : [model.faceColors1[face], model.faceColors2[face], third];
      const alpha = model.faceAlphas ? 1 - (model.faceAlphas[face] & 0xff) / 255 : 1;
      const target = alpha < 0.999 ? clear : opaque;
      corners.forEach((corner, index) => {
        target.positions.push(...corner);
        target.normals.push(0, 1, 0);
        target.colors.push(...hslToRgb(colours[index] & 0xffff), alpha);
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], corner[axis]);
          max[axis] = Math.max(max[axis], corner[axis]);
        }
      });
      shown++;
    }
    if (!shown) { min = [0, 0, 0]; max = [0, 0, 0]; }
    const center = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2);
    const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    return { opaque, clear, shown, hidden: model.faceCount - shown, colourFaces: new Map(), center, radius, lit: true, min, max,
      size: [0, 1, 2].map((axis) => max[axis] - min[axis]) };
  }

  /** Which frame plays `cycles` client cycles (20 ms) in, looping, for frames of these lengths. */
  function frameAt(lengths, cycles) {
    const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
    let rest = cycles % total;
    for (let index = 0; index < lengths.length; index++) {
      if (rest < lengths[index]) return index;
      rest -= lengths[index];
    }
    return lengths.length - 1;
  }

  const VERTEX_SHADER = `
    attribute vec3 position; attribute vec3 normal; attribute vec4 color;
    uniform mat4 view; uniform mat4 projection;
    varying vec4 vColor; varying vec3 vNormal;
    void main() { vColor = color; vNormal = normal; gl_Position = projection * view * vec4(position, 1.0); }`;
  const FRAGMENT_SHADER = `
    precision mediump float;
    varying vec4 vColor; varying vec3 vNormal;
    uniform vec3 light; uniform float lit;
    void main() {
      float diffuse = abs(dot(normalize(vNormal), light));
      gl_FragColor = vec4(lit > 0.5 ? vColor.rgb : vColor.rgb * (0.55 + 0.5 * diffuse), vColor.a);
    }`;

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), range = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * range, -1, 0, 0, 2 * far * near * range, 0];
  }

  function lookAt(eye, target) {
    const sub = (a, b) => a.map((value, index) => value - b[index]);
    const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((value) => value / l); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = norm(sub(eye, target));
    const x = norm(cross([0, 1, 0], z));
    const y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }

  class ModelPreview {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });
      if (!gl) throw new Error("This browser can't draw WebGL");
      this.gl = gl;
      const shader = (type, source) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      this.program = program;
      this.attributes = ["position", "normal", "color"].map((name) => gl.getAttribLocation(program, name));
      this.uniforms = { view: gl.getUniformLocation(program, "view"), projection: gl.getUniformLocation(program, "projection"), light: gl.getUniformLocation(program, "light"), lit: gl.getUniformLocation(program, "lit") };
      this.parts = [];
      this.resetView();
      this.bindInput();
      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(canvas);
    }

    resetView() {
      Object.assign(this, DEFAULT_VIEW);
      this.draw();
    }

    bindInput() {
      let drag = null;
      this.canvas.addEventListener("pointerdown", (event) => {
        drag = { x: event.clientX, y: event.clientY };
        this.canvas.setPointerCapture(event.pointerId);
      });
      this.canvas.addEventListener("pointermove", (event) => {
        if (!drag) return;
        this.yaw += (event.clientX - drag.x) * 0.01;
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (event.clientY - drag.y) * 0.01));
        drag = { x: event.clientX, y: event.clientY };
        this.draw();
      });
      const end = () => { drag = null; };
      this.canvas.addEventListener("pointerup", end);
      this.canvas.addEventListener("pointercancel", end);
      this.canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        this.zoom = Math.max(0.2, Math.min(8, this.zoom * Math.exp(-event.deltaY * 0.0015)));
        this.draw();
      }, { passive: false });
      this.canvas.addEventListener("dblclick", () => this.resetView());
    }

    /**
     * Shows a decoded model; `recolours` ([from, to] pairs) are applied when given. Another model
     * starts from the default view; the same one again (in-game colours on or off) keeps the view.
     */
    show(model, recolours) {
      this.stop();
      if (model !== this.model) {
        this.model = model;
        Object.assign(this, DEFAULT_VIEW);
      }
      const mesh = buildMesh(model, recolours);
      this.upload(mesh);
      this.draw();
      return mesh;
    }

    /**
     * Plays an animation: `meshAt(index)` is frame `index` as a lit mesh (buildLitMesh), shown for
     * `lengths[index]` client cycles of 20 ms, looping. The camera frames every pose, so it holds
     * still while the body moves. Another `key` (body and animation) starts from the default view.
     * `onFrame(index)` hears each new frame.
     */
    play({ key, lengths, meshAt, onFrame }) {
      this.stop();
      if (key !== this.model) {
        this.model = key;
        Object.assign(this, DEFAULT_VIEW);
      }
      const meshes = new Map();
      const mesh = (index) => {
        if (!meshes.has(index)) meshes.set(index, meshAt(index));
        return meshes.get(index);
      };
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      const samples = Math.min(lengths.length, 24);
      for (let sample = 0; sample < samples; sample++) {
        const posed = mesh(Math.floor((sample * lengths.length) / samples));
        if (!posed.shown) continue;
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], posed.min[axis]);
          max[axis] = Math.max(max[axis], posed.max[axis]);
        }
      }
      this.framing = min[0] === Infinity ? null : {
        center: [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2),
        radius: Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2),
      };
      const playback = { lengths, mesh, onFrame, index: -1, start: performance.now(), pausedAt: null };
      this.playback = playback;
      const tick = (now) => {
        if (this.playback !== playback) return;
        const elapsed = (playback.pausedAt ?? now) - playback.start;
        const index = frameAt(lengths, Math.max(0, Math.floor(elapsed / 20)));
        if (index !== playback.index) {
          playback.index = index;
          this.upload(mesh(index));
          this.draw();
          onFrame?.(index);
        }
        playback.frame = requestAnimationFrame(tick);
      };
      playback.frame = requestAnimationFrame(tick);
      return mesh(0);
    }

    /** Pauses or resumes the animation playing; true while paused. */
    togglePause() {
      const playback = this.playback;
      if (!playback) return false;
      const now = performance.now();
      if (playback.pausedAt === null) playback.pausedAt = now;
      else {
        playback.start += now - playback.pausedAt;
        playback.pausedAt = null;
      }
      return playback.pausedAt !== null;
    }

    stop() {
      if (this.playback) cancelAnimationFrame(this.playback.frame);
      this.playback = null;
      this.framing = null;
    }

    upload(mesh) {
      const gl = this.gl;
      for (const part of this.parts) part.buffers.forEach((buffer) => gl.deleteBuffer(buffer));
      this.mesh = mesh;
      this.parts = [mesh.opaque, mesh.clear].map((data) => {
        const buffers = [data.positions, data.normals, data.colors].map((values) => {
          const buffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
          return buffer;
        });
        return { buffers, count: data.positions.length / 3 };
      });
    }

    draw() {
      const gl = this.gl;
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!this.mesh) return;
      const { center, radius } = this.framing ?? this.mesh;
      const distance = (radius * 2.6) / this.zoom;
      const eye = [
        center[0] + distance * Math.cos(this.pitch) * Math.sin(this.yaw),
        center[1] + distance * Math.sin(this.pitch),
        center[2] + distance * Math.cos(this.pitch) * Math.cos(this.yaw),
      ];
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.uniforms.view, false, new Float32Array(lookAt(eye, center)));
      gl.uniformMatrix4fv(this.uniforms.projection, false, new Float32Array(perspective(0.8, width / height, distance / 100, distance + radius * 4)));
      const light = [0.4, 0.8, 0.45];
      const l = Math.hypot(...light);
      gl.uniform3f(this.uniforms.light, light[0] / l, light[1] / l, light[2] / l);
      gl.uniform1f(this.uniforms.lit, this.mesh.lit ? 1 : 0);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      this.parts.forEach((part, index) => {
        if (!part.count) return;
        const seeThrough = index === 1;
        gl.depthMask(!seeThrough);
        if (seeThrough) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
        part.buffers.forEach((buffer, slot) => {
          const location = this.attributes[slot];
          if (location < 0) return;
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, slot === 2 ? 4 : 3, gl.FLOAT, false, 0, 0);
        });
        gl.drawArrays(gl.TRIANGLES, 0, part.count);
      });
      gl.depthMask(true);
    }
  }

  window.ModelPreview = ModelPreview;
  window.ModelPreviewParts = { hslToRgb, hslToHex, buildMesh, buildLitMesh, frameAt };
})();
