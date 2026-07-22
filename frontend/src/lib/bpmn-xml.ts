// Generate a valid BPMN 2.0 XML string (with BPMNDI) from a ProcessInstance.
// This is what feeds bpmn-js — proving the renderer works on real BPMN XML.
// Users can also paste/upload their own XML which bypasses this generator entirely.

import type { BpmnEdge, BpmnNode, ProcessInstance } from "./mock-data";

function dims(n: BpmnNode): { w: number; h: number } {
  if (n.type === "startEvent" || n.type === "endEvent" || n.type === "boundaryTimer") {
    return { w: 36, h: 36 };
  }
  if (n.type === "exclusiveGateway" || n.type === "parallelGateway") {
    return { w: 50, h: 50 };
  }
  return { w: 120, h: 80 };
}

function center(n: BpmnNode): { x: number; y: number } {
  const d = dims(n);
  return { x: n.x + d.w / 2, y: n.y + d.h / 2 };
}

function elementXml(n: BpmnNode): string {
  const name = escapeXml(n.name);
  switch (n.type) {
    case "startEvent":
      return `<bpmn:startEvent id="${n.id}" name="${name}" />`;
    case "endEvent":
      return `<bpmn:endEvent id="${n.id}" name="${name}" />`;
    case "userTask":
      return `<bpmn:userTask id="${n.id}" name="${name}"${
        n.multiInstance
          ? `>\n      <bpmn:multiInstanceLoopCharacteristics isSequential="false" />\n    </bpmn:userTask`
          : ` /`
      }>`;
    case "serviceTask":
      return `<bpmn:serviceTask id="${n.id}" name="${name}" />`;
    case "scriptTask":
      return `<bpmn:scriptTask id="${n.id}" name="${name}" />`;
    case "callActivity":
      return `<bpmn:callActivity id="${n.id}" name="${name}" calledElement="${n.id}Sub" />`;
    case "exclusiveGateway":
      return `<bpmn:exclusiveGateway id="${n.id}" name="${name}" />`;
    case "parallelGateway":
      return `<bpmn:parallelGateway id="${n.id}" name="${name}" />`;
    case "boundaryTimer":
      return `<bpmn:boundaryEvent id="${n.id}" name="${name}" attachedToRef="${n.attachedTo ?? ""}" cancelActivity="false">
      <bpmn:timerEventDefinition />
    </bpmn:boundaryEvent>`;
  }
}

function edgeXml(e: BpmnEdge): string {
  const name = e.label ? ` name="${escapeXml(e.label)}"` : "";
  const cond = e.condition
    ? `>
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${escapeXml(e.condition)}</bpmn:conditionExpression>
    </bpmn:sequenceFlow`
    : ` /`;
  return `<bpmn:sequenceFlow id="${e.id}" sourceRef="${e.source}" targetRef="${e.target}"${name}${cond}>`;
}

function shapeDi(n: BpmnNode): string {
  const d = dims(n);
  // For events (start/end/boundary) and gateways, bpmn-js renders the name as
  // an *external* label outside the shape. Without explicit BPMNLabel bounds
  // it defaults to a narrow ~90px box which wraps two-word names
  // ("Order placed" → "Order \n placed") straight into the shape above/below.
  // Provide generous bounds sized to the text so the label sits fully clear
  // of the icon and never collides with neighbouring nodes.
  const isSmall =
    n.type === "startEvent" ||
    n.type === "endEvent" ||
    n.type === "boundaryTimer" ||
    n.type === "exclusiveGateway" ||
    n.type === "parallelGateway";
  let labelXml = `<bpmndi:BPMNLabel />`;
  if (isSmall && n.name) {
    // ~7.6px per glyph at 12px font (incl. halo stroke); clamp so very long
    // names wrap on two lines rather than pushing off-canvas.
    const textW = Math.min(200, Math.max(110, n.name.length * 7.6 + 12));
    const lw = Math.round(textW);
    const lh = n.name.length > 24 ? 32 : 18;
    const lx = Math.round(n.x + d.w / 2 - lw / 2);
    const ly = Math.round(n.y + d.h + 10);
    labelXml = `<bpmndi:BPMNLabel><dc:Bounds x="${lx}" y="${ly}" width="${lw}" height="${lh}" /></bpmndi:BPMNLabel>`;
  }
  return `<bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}">
      <dc:Bounds x="${n.x}" y="${n.y}" width="${d.w}" height="${d.h}" />
      ${labelXml}
    </bpmndi:BPMNShape>`;
}

function bounds(n: BpmnNode) {
  const d = dims(n);
  return { x: n.x, y: n.y, w: d.w, h: d.h, cx: n.x + d.w / 2, cy: n.y + d.h / 2 };
}

// Compute orthogonal (Manhattan) waypoints between two shapes.
// Exits/enters through the nearest side and inserts 1–2 bends so lines
// never cut diagonally through nodes.
function orthogonalWaypoints(
  s: BpmnNode,
  t: BpmnNode,
): Array<{ x: number; y: number }> {
  const a = bounds(s);
  const b = bounds(t);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  // Boundary events attach to their host — route from bottom by default.
  if (s.type === "boundaryTimer") {
    const start = { x: a.cx, y: a.y + a.h };
    const midY = start.y + 40;
    return [start, { x: start.x, y: midY }, { x: b.cx, y: midY }, { x: b.cx, y: b.y }];
  }

  if (horizontal) {
    // Left-to-right (or right-to-left) main flow.
    const forward = dx >= 0;
    const sx = forward ? a.x + a.w : a.x;
    const tx = forward ? b.x : b.x + b.w;
    if (Math.abs(dy) < 6) {
      return [{ x: sx, y: a.cy }, { x: tx, y: b.cy }];
    }
    // Bend at midpoint between the two shapes' facing edges.
    const midX = sx + (tx - sx) / 2;
    return [
      { x: sx, y: a.cy },
      { x: midX, y: a.cy },
      { x: midX, y: b.cy },
      { x: tx, y: b.cy },
    ];
  }

  // Vertical dominant — exit top/bottom, enter opposite side.
  const down = dy >= 0;
  const sy = down ? a.y + a.h : a.y;
  const ty = down ? b.y : b.y + b.h;
  if (Math.abs(dx) < 6) {
    return [{ x: a.cx, y: sy }, { x: b.cx, y: ty }];
  }
  const midY = sy + (ty - sy) / 2;
  return [
    { x: a.cx, y: sy },
    { x: a.cx, y: midY },
    { x: b.cx, y: midY },
    { x: b.cx, y: ty },
  ];
}

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const PAD = 14; // clearance around obstacles

function rectOf(n: BpmnNode): Rect {
  const d = dims(n);
  return { x: n.x, y: n.y, w: d.w, h: d.h };
}
function inflate(r: Rect, p: number): Rect {
  return { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
}

// Segment-rectangle intersection for axis-aligned segments.
function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
  if (a.y === b.y) {
    // horizontal segment
    if (a.y <= y1 || a.y >= y2) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return hi > x1 && lo < x2;
  }
  if (a.x === b.x) {
    // vertical segment
    if (a.x <= x1 || a.x >= x2) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return hi > y1 && lo < y2;
  }
  return false;
}

// Route around a single obstacle. For a horizontal segment cutting through `r`,
// detour above or below (whichever is closer to a "safe" y). For a vertical
// segment, detour left or right. Returns replacement points that go from `a` to `b`.
function detour(a: Pt, b: Pt, r: Rect, obstacles: Rect[]): Pt[] {
  if (a.y === b.y) {
    // horizontal — bypass over top or bottom
    const above = r.y - PAD;
    const below = r.y + r.h + PAD;
    const preferAbove = Math.abs(a.y - above) <= Math.abs(a.y - below);
    const tryOrder: number[] = preferAbove ? [above, below] : [below, above];
    for (const bypassY of tryOrder) {
      // Find x-bounds of obstacle cluster at this y-level (merge nearby rects)
      const [x1, x2] = clusterXRange(r, obstacles, bypassY);
      const enterX = Math.min(a.x, b.x) < x1 ? x1 - PAD : x2 + PAD;
      const exitX = Math.max(a.x, b.x) > x2 ? x2 + PAD : x1 - PAD;
      const pts: Pt[] = [
        { x: enterX, y: a.y },
        { x: enterX, y: bypassY },
        { x: exitX, y: bypassY },
        { x: exitX, y: b.y },
      ];
      if (!pathHitsAny([a, ...pts, b], obstacles)) return pts;
    }
    // Fallback: return one bend even if imperfect
    return [
      { x: a.x, y: above },
      { x: b.x, y: above },
    ];
  }
  if (a.x === b.x) {
    const left = r.x - PAD;
    const right = r.x + r.w + PAD;
    const preferLeft = Math.abs(a.x - left) <= Math.abs(a.x - right);
    const tryOrder: number[] = preferLeft ? [left, right] : [right, left];
    for (const bypassX of tryOrder) {
      const [y1, y2] = clusterYRange(r, obstacles, bypassX);
      const enterY = Math.min(a.y, b.y) < y1 ? y1 - PAD : y2 + PAD;
      const exitY = Math.max(a.y, b.y) > y2 ? y2 + PAD : y1 - PAD;
      const pts: Pt[] = [
        { x: a.x, y: enterY },
        { x: bypassX, y: enterY },
        { x: bypassX, y: exitY },
        { x: b.x, y: exitY },
      ];
      if (!pathHitsAny([a, ...pts, b], obstacles)) return pts;
    }
    return [
      { x: left, y: a.y },
      { x: left, y: b.y },
    ];
  }
  return [];
}

// When bypassing a horizontal segment above/below y, extend the x-range to
// cover any obstacles that also intersect that bypass line.
function clusterXRange(seed: Rect, obstacles: Rect[], bypassY: number): [number, number] {
  let x1 = seed.x;
  let x2 = seed.x + seed.w;
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of obstacles) {
      if (bypassY <= o.y || bypassY >= o.y + o.h) continue;
      if (o.x + o.w < x1 - PAD || o.x > x2 + PAD) continue;
      const nx1 = Math.min(x1, o.x);
      const nx2 = Math.max(x2, o.x + o.w);
      if (nx1 !== x1 || nx2 !== x2) { x1 = nx1; x2 = nx2; changed = true; }
    }
  }
  return [x1, x2];
}
function clusterYRange(seed: Rect, obstacles: Rect[], bypassX: number): [number, number] {
  let y1 = seed.y;
  let y2 = seed.y + seed.h;
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of obstacles) {
      if (bypassX <= o.x || bypassX >= o.x + o.w) continue;
      if (o.y + o.h < y1 - PAD || o.y > y2 + PAD) continue;
      const ny1 = Math.min(y1, o.y);
      const ny2 = Math.max(y2, o.y + o.h);
      if (ny1 !== y1 || ny2 !== y2) { y1 = ny1; y2 = ny2; changed = true; }
    }
  }
  return [y1, y2];
}

function pathHitsAny(pts: Pt[], obstacles: Rect[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const o of obstacles) if (segHitsRect(pts[i], pts[i + 1], o)) return true;
  }
  return false;
}

// Remove collinear/duplicate points so the final path is minimal.
function simplify(pts: Pt[]): Pt[] {
  const EPS = 0.75; // sub-pixel dedup so anchors from geometric snapping merge
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push(p);
  }
  for (let i = 1; i < out.length - 1; ) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const vertical = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
    const horizontal = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
    if (vertical || horizontal) {
      out.splice(i, 1);
    } else i++;
  }
  return out;
}


// Iteratively resolve obstacle crossings on an orthogonal polyline.
function avoidObstacles(pts: Pt[], obstacles: Rect[]): Pt[] {
  let current = pts.slice();
  for (let iter = 0; iter < 6; iter++) {
    let hit = false;
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i], b = current[i + 1];
      const bad = obstacles.find((o) => segHitsRect(a, b, o));
      if (!bad) continue;
      const replacement = detour(a, b, bad, obstacles);
      current = [...current.slice(0, i + 1), ...replacement, ...current.slice(i + 1)];
      current = simplify(current);
      hit = true;
      break;
    }
    if (!hit) break;
  }
  return simplify(current);
}

// Gateways are diamonds — for conditional flows, exit from the diamond tip
// facing the target so branches (yes/no) fan out cleanly instead of stacking.
function gatewayExit(s: BpmnNode, t: BpmnNode): Pt | null {
  if (s.type !== "exclusiveGateway" && s.type !== "parallelGateway") return null;
  const a = bounds(s), b = bounds(t);
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? a.x + a.w : a.x, y: a.cy };
  }
  return { x: a.cx, y: dy >= 0 ? a.y + a.h : a.y };
}

export interface RoutedEdge {
  waypoints: Pt[];
  baseWaypoints: Pt[];
  detoured: boolean;
  obstaclesHit: number;
  labelBounds?: { x: number; y: number; w: number; h: number };
}

type Side = "left" | "right" | "top" | "bottom";

function isCircle(n: BpmnNode): boolean {
  return n.type === "startEvent" || n.type === "endEvent" || n.type === "boundaryTimer";
}
function isDiamond(n: BpmnNode): boolean {
  return n.type === "exclusiveGateway" || n.type === "parallelGateway";
}

// Compute the anchor point on `side` at fractional position `frac` (0..1)
// along that side. For circles and diamonds, snap the point onto the true
// shape border along the ray from the center — so staggered anchors don't
// float in empty corners of the bounding box.
function anchorOnShape(n: BpmnNode, side: Side, frac: number): Pt {
  const b = bounds(n);
  const hw = b.w / 2, hh = b.h / 2;
  const f = Math.max(0.08, Math.min(0.92, frac)); // keep off the corners
  if (side === "left" || side === "right") {
    const y = b.y + f * b.h;
    if (isCircle(n)) {
      const r = Math.min(hw, hh);
      const dy = Math.max(-r + 0.5, Math.min(r - 0.5, y - b.cy));
      const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
      return { x: side === "right" ? b.cx + dx : b.cx - dx, y: b.cy + dy };
    }
    if (isDiamond(n)) {
      const dy = Math.max(-hh + 0.5, Math.min(hh - 0.5, y - b.cy));
      const dx = hw * (1 - Math.abs(dy) / hh);
      return { x: side === "right" ? b.cx + dx : b.cx - dx, y: b.cy + dy };
    }
    return { x: side === "right" ? b.x + b.w : b.x, y };
  }
  // top / bottom
  const x = b.x + f * b.w;
  if (isCircle(n)) {
    const r = Math.min(hw, hh);
    const dx = Math.max(-r + 0.5, Math.min(r - 0.5, x - b.cx));
    const dy = Math.sqrt(Math.max(0, r * r - dx * dx));
    return { x: b.cx + dx, y: side === "bottom" ? b.cy + dy : b.cy - dy };
  }
  if (isDiamond(n)) {
    const dx = Math.max(-hw + 0.5, Math.min(hw - 0.5, x - b.cx));
    const dy = hh * (1 - Math.abs(dx) / hw);
    return { x: b.cx + dx, y: side === "bottom" ? b.cy + dy : b.cy - dy };
  }
  return { x, y: side === "bottom" ? b.y + b.h : b.y };
}

// Pick the side of `n` that faces `toward` based on direction.
function pickSide(n: BpmnNode, toward: Pt): Side {
  const b = bounds(n);
  const dx = toward.x - b.cx;
  const dy = toward.y - b.cy;
  const useHorizontal = Math.abs(dx) / (b.w / 2) >= Math.abs(dy) / (b.h / 2);
  if (useHorizontal) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

// Force the segment adjacent to `anchor` to be perpendicular to `side`.
// If the adjacent point is already sub-pixel-aligned on the relevant axis
// we skip the bend so the arrowhead doesn't get a tiny hook that reads as
// a second overlapping stub.
function perpendicularize(anchor: Pt, side: Side, adjacent: Pt): Pt[] {
  const EPS = 0.75;
  const horiz = side === "left" || side === "right";
  if (horiz) {
    if (Math.abs(adjacent.y - anchor.y) < EPS) return [];
    return [{ x: adjacent.x, y: anchor.y }];
  }
  if (Math.abs(adjacent.x - anchor.x) < EPS) return [];
  return [{ x: anchor.x, y: adjacent.y }];
}

// Build a clean orthogonal polyline between two anchor points on given
// sides. If the anchors already share the perpendicular axis, emit a
// straight line; otherwise insert a single midpoint bend so we never
// zig-zag along the same axis (which would look like two overlapping
// parallel arrows).
function orthogonalConnect(a: Pt, aSide: Side, b: Pt, _bSide: Side): Pt[] {
  const EPS = 0.75;
  const aHoriz = aSide === "left" || aSide === "right";
  if (aHoriz) {
    if (Math.abs(a.y - b.y) < EPS) return [a, { x: b.x, y: a.y }];
    const midX = (a.x + b.x) / 2;
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  if (Math.abs(a.x - b.x) < EPS) return [a, { x: a.x, y: b.y }];
  const midY = (a.y + b.y) / 2;
  return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
}




export interface SlotHint {
  sourceFrac?: number;
  targetFrac?: number;
}

export function computeEdgeRoute(
  e: BpmnEdge,
  allNodes: BpmnNode[],
  slots?: SlotHint,
): RoutedEdge | null {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const s = byId.get(e.source);
  const t = byId.get(e.target);
  if (!s || !t) return null;

  const skip = new Set<string>([s.id, t.id]);
  for (const n of allNodes) {
    if (n.type === "boundaryTimer" && n.attachedTo && skip.has(n.attachedTo)) skip.add(n.id);
  }
  const obstacles = allNodes
    .filter((n) => !skip.has(n.id))
    .map((n) => inflate(rectOf(n), PAD));

  const srcFrac = slots?.sourceFrac ?? 0.5;
  const tgtFrac = slots?.targetFrac ?? 0.5;

  let waypoints: Pt[];
  if (e.waypoints && e.waypoints.length) {
    const first = e.waypoints[0];
    const last = e.waypoints[e.waypoints.length - 1];
    const srcSide = pickSide(s, first);
    const dstSide = pickSide(t, last);
    const srcAnchor = anchorOnShape(s, srcSide, srcFrac);
    const dstAnchor = anchorOnShape(t, dstSide, tgtFrac);
    const interior = e.waypoints.slice(1, e.waypoints.length - 1);
    if (interior.length === 0) {
      // No interior bends: connect the two anchors with a single
      // orthogonal bend so a slight axis mismatch (e.g. circle→rect y
      // offset) doesn't produce a Z-shaped double-arrow pattern.
      waypoints = orthogonalConnect(srcAnchor, srcSide, dstAnchor, dstSide);
    } else {
      const startBend = perpendicularize(srcAnchor, srcSide, interior[0]);
      const endBend = perpendicularize(dstAnchor, dstSide, interior[interior.length - 1]);
      waypoints = [srcAnchor, ...startBend, ...interior, ...endBend, dstAnchor];
    }
  } else {
    waypoints = orthogonalWaypoints(s, t);

    const exit = gatewayExit(s, t);
    if (exit) {
      waypoints[0] = exit;
      const tb = bounds(t);
      const last = waypoints[waypoints.length - 1];
      if (exit.x === s.x || exit.x === s.x + rectOf(s).w) {
        if (exit.y !== last.y) {
          const midX = exit.x + (last.x - exit.x) / 2;
          waypoints = [exit, { x: midX, y: exit.y }, { x: midX, y: last.y }, last];
        } else {
          waypoints = [exit, last];
        }
        waypoints[waypoints.length - 1] = { x: exit.x < tb.cx ? tb.x : tb.x + tb.w, y: last.y };
      } else {
        if (exit.x !== last.x) {
          const midY = exit.y + (last.y - exit.y) / 2;
          waypoints = [exit, { x: exit.x, y: midY }, { x: last.x, y: midY }, last];
        } else {
          waypoints = [exit, last];
        }
        waypoints[waypoints.length - 1] = { x: last.x, y: exit.y < tb.cy ? tb.y : tb.y + tb.h };
      }
    }
    // Re-anchor endpoints geometrically with slot fractions.
    if (waypoints.length >= 2) {
      const srcSide = pickSide(s, waypoints[1]);
      const dstSide = pickSide(t, waypoints[waypoints.length - 2]);
      const srcAnchor = anchorOnShape(s, srcSide, srcFrac);
      const dstAnchor = anchorOnShape(t, dstSide, tgtFrac);
      const middle = waypoints.slice(1, waypoints.length - 1);
      if (middle.length === 0) {
        // Straight/near-straight edge: connect the two anchors with a
        // single clean bend instead of two perpendicular hooks that
        // would collapse into a Z-shaped double arrow.
        waypoints = orthogonalConnect(srcAnchor, srcSide, dstAnchor, dstSide);
      } else {
        const startBend = perpendicularize(srcAnchor, srcSide, middle[0]);
        const endBend = perpendicularize(dstAnchor, dstSide, middle[middle.length - 1]);
        waypoints = [srcAnchor, ...startBend, ...middle, ...endBend, dstAnchor];
      }
    }

  }

  const baseWaypoints = simplify(waypoints);
  let obstaclesHit = 0;
  for (let i = 0; i < baseWaypoints.length - 1; i++) {
    for (const o of obstacles) if (segHitsRect(baseWaypoints[i], baseWaypoints[i + 1], o)) obstaclesHit++;
  }
  let routed = avoidObstacles(baseWaypoints, obstacles);
  // Safety net: if simplification/detour collapsed the polyline to fewer
  // than 2 distinct points, fall back to a straight orthogonal connection
  // between shape centers so a visible line is always drawn (the diagram
  // remains readable even when routing degenerates).
  if (routed.length < 2) {
    const sb = bounds(s), tb = bounds(t);
    const srcSide = pickSide(s, { x: tb.cx, y: tb.cy });
    const dstSide = pickSide(t, { x: sb.cx, y: sb.cy });
    routed = orthogonalConnect(
      anchorOnShape(s, srcSide, 0.5),
      srcSide,
      anchorOnShape(t, dstSide, 0.5),
      dstSide,
    );
  }
  const detoured = obstaclesHit > 0 || routed.length !== baseWaypoints.length;
  return { waypoints: routed, baseWaypoints, detoured, obstaclesHit };
}

// Batch: assign staggered slot fractions when multiple edges share a
// (node, side), so anchor points spread evenly instead of stacking.
export function computeAllEdgeRoutes(
  edges: BpmnEdge[],
  allNodes: BpmnNode[],
): Map<string, RoutedEdge> {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  type Sides = { src?: Side; tgt?: Side };
  const edgeSides = new Map<string, Sides>();
  for (const e of edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t) continue;
    let firstAdj: Pt, lastAdj: Pt;
    if (e.waypoints && e.waypoints.length) {
      firstAdj = e.waypoints[0];
      lastAdj = e.waypoints[e.waypoints.length - 1];
    } else {
      const tb = bounds(t), sb = bounds(s);
      firstAdj = { x: tb.cx, y: tb.cy };
      lastAdj = { x: sb.cx, y: sb.cy };
    }
    edgeSides.set(e.id, { src: pickSide(s, firstAdj), tgt: pickSide(t, lastAdj) });
  }
  // Group per (nodeId, side, direction)
  const groups = new Map<string, string[]>();
  const push = (k: string, id: string) => {
    const arr = groups.get(k) ?? [];
    arr.push(id);
    groups.set(k, arr);
  };
  const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
  for (const e of sortedEdges) {
    const sides = edgeSides.get(e.id);
    if (!sides) continue;
    if (sides.src) push(`${e.source}::${sides.src}::out`, e.id);
    if (sides.tgt) push(`${e.target}::${sides.tgt}::in`, e.id);
  }
  const slots = new Map<string, SlotHint>();
  for (const [key, ids] of groups) {
    const n = ids.length;
    const isOut = key.endsWith("::out");
    // Sort inside each group by the position of the far endpoint on the
    // perpendicular axis, so anchors run in the same order as their
    // neighbours (avoids crossings).
    ids.sort((a, b) => {
      const ea = edges.find((x) => x.id === a)!;
      const eb = edges.find((x) => x.id === b)!;
      const nodeIdA = isOut ? ea.target : ea.source;
      const nodeIdB = isOut ? eb.target : eb.source;
      const na = byId.get(nodeIdA), nb = byId.get(nodeIdB);
      if (!na || !nb) return 0;
      const side = key.split("::")[1] as Side;
      const horiz = side === "left" || side === "right";
      return horiz ? bounds(na).cy - bounds(nb).cy : bounds(na).cx - bounds(nb).cx;
    });
    ids.forEach((id, i) => {
      const frac = n === 1 ? 0.5 : (i + 1) / (n + 1);
      const existing = slots.get(id) ?? {};
      slots.set(id, isOut ? { ...existing, sourceFrac: frac } : { ...existing, targetFrac: frac });
    });
  }
  const out = new Map<string, RoutedEdge>();
  for (const e of edges) {
    const r = computeEdgeRoute(e, allNodes, slots.get(e.id));
    if (r) out.set(e.id, r);
  }
  assignEdgeLabelBounds(edges, out);
  return out;
}

// Approximate a label's rendered width from its text (BPMN default font is
// ~6px per glyph at 12px). Kept modest so bounds stay compact.
function labelSizeFor(e: BpmnEdge): { w: number; h: number } | null {
  const text = e.label ?? (e.condition ? "ƒ" : "");
  if (!text && !e.condition) return null;
  const chars = Math.max(text.length, e.condition ? 4 : 0);
  const w = Math.max(28, Math.min(140, chars * 6 + 12));
  return { w, h: 18 };
}

// Pick the segment of an edge most suitable for the label: prefer the
// longest interior segment (away from endpoints where flows cluster).
function pickLabelSegment(wps: Pt[]): { a: Pt; b: Pt } {
  if (wps.length < 2) return { a: wps[0], b: wps[0] };
  if (wps.length === 2) return { a: wps[0], b: wps[1] };
  let best = 1, bestLen = -1;
  // Skip segments touching endpoints if a longer interior segment exists.
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const interior = i > 0 && i < wps.length - 2;
    const score = interior ? len * 1.4 : len;
    if (score > bestLen) { bestLen = score; best = i; }
  }
  return { a: wps[best], b: wps[best + 1] };
}

// Assign non-overlapping label bounds. For each edge, seed the label near
// the middle of its chosen segment, then nudge perpendicular to the segment
// until it stops colliding with previously placed labels.
function assignEdgeLabelBounds(edges: BpmnEdge[], routes: Map<string, RoutedEdge>): void {
  type Rect2 = { x: number; y: number; w: number; h: number };
  const placed: Rect2[] = [];
  const overlaps = (a: Rect2, b: Rect2) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // Place longer edges first so short/crowded ones get nudged, not the reverse.
  const order = [...edges].sort((a, b) => {
    const ra = routes.get(a.id), rb = routes.get(b.id);
    const la = ra ? ra.waypoints.length : 0;
    const lb = rb ? rb.waypoints.length : 0;
    return lb - la;
  });

  for (const e of order) {
    const r = routes.get(e.id);
    if (!r) continue;
    const size = labelSizeFor(e);
    if (!size) continue;
    const { a, b } = pickLabelSegment(r.waypoints);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    // Offset the label off the line (above horizontal segments, right of
    // vertical ones) so it doesn't sit on the arrow.
    const baseOffset = horiz ? -(size.h / 2 + 6) : size.w / 2 + 6;
    let step = 0;
    let rect: Rect2 = { x: 0, y: 0, w: size.w, h: size.h };
    for (; step < 8; step++) {
      // Alternate sides of the segment on successive nudges.
      const dir = step % 2 === 0 ? 1 : -1;
      const magnitude = baseOffset + dir * step * (size.h + 4);
      if (horiz) {
        rect = { x: mx - size.w / 2, y: my + magnitude, w: size.w, h: size.h };
      } else {
        rect = { x: mx + magnitude, y: my - size.h / 2, w: size.w, h: size.h };
      }
      if (!placed.some((p) => overlaps(rect, p))) break;
    }
    r.labelBounds = rect;
    placed.push(rect);
  }
}

function edgeDi(e: BpmnEdge, route: RoutedEdge): string {
  const waypoints = route.waypoints;
  const wp = waypoints.map((p) => `      <di:waypoint x="${p.x}" y="${p.y}" />`).join("\n");
  const lb = route.labelBounds;
  const label = lb
    ? `\n      <bpmndi:BPMNLabel><dc:Bounds x="${lb.x}" y="${lb.y}" width="${lb.w}" height="${lb.h}" /></bpmndi:BPMNLabel>`
    : e.label || e.condition
      ? (() => {
          const mid = waypoints[Math.floor(waypoints.length / 2)] ?? waypoints[0];
          return `\n      <bpmndi:BPMNLabel><dc:Bounds x="${mid.x - 40}" y="${mid.y - 20}" width="80" height="20" /></bpmndi:BPMNLabel>`;
        })()
      : "";
  return `<bpmndi:BPMNEdge id="${e.id}_di" bpmnElement="${e.id}">
${wp}${label}
    </bpmndi:BPMNEdge>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function processInstanceToBpmnXml(p: ProcessInstance): string {
  // Guard: drop sequence flows whose source/target aren't in the node set.
  // If we emit them anyway, bpmn-js raises an import warning ("missing
  // sourceRef/targetRef") and silently drops the edge — which manifests as
  // end events looking floating/unconnected because their incoming line
  // never renders. Log a dev warning listing both dropped edges and any
  // endEvent that has zero incoming edges at all (upstream data gap).
  const nodeIds = new Set(p.nodes.map((n) => n.id));
  const validEdges = p.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  const droppedEdges = p.edges.filter((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target));
  const incoming = new Set(validEdges.map((e) => e.target));
  const orphanEnds = p.nodes.filter((n) => n.type === "endEvent" && !incoming.has(n.id));
  if (typeof console !== "undefined" && (droppedEdges.length || orphanEnds.length)) {
    // eslint-disable-next-line no-console
    console.warn("[bpmn-xml] diagram gaps for instance", p.id, {
      droppedEdges: droppedEdges.map((e) => `${e.id}(${e.source}→${e.target})`),
      orphanEndEvents: orphanEnds.map((n) => `${n.id}(${n.name})`),
    });
  }

  const elements = p.nodes.map((n) => `    ${elementXml(n)}`).join("\n");
  const flows = validEdges.map((e) => `    ${edgeXml(e)}`).join("\n");
  const shapes = p.nodes.map((n) => `    ${shapeDi(n)}`).join("\n");
  const routes = computeAllEdgeRoutes(validEdges, p.nodes);
  const edges = validEdges
    .map((e) => {
      const r = routes.get(e.id);
      return r ? `    ${edgeDi(e, r)}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const procId = `Process_${p.definitionKey}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  id="Definitions_${p.id}" targetNamespace="http://flowable.org/console">
  <bpmn:process id="${procId}" name="${escapeXml(p.definitionName)}" isExecutable="true">
${elements}
${flows}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${procId}">
${shapes}
${edges}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}
