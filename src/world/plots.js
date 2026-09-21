import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { DECK_TEXTURE_SCALE, KERB_UV, deckSurface, kerbSurface } from './surfaces.js'
import { atlasTexture, hasPart, part } from './kit.js'
import { mulberry } from './planet.js'

/**
 * Project plots — the fenced-off sections of the map, one per repo.
 *
 * Plots sit on a hexagonal lattice, and a project claims **as many cells as it has threads
 * to house**: a repo with forty sessions sprawls across six tiles, a one-off gets a single
 * tile. The cells tile exactly, so a multi-cell plot reads as one continuous zone, and the
 * accent border is drawn only on the edges that actually face something else — internal
 * seams between a project's own cells get no border at all.
 *
 * Cells are handed out in a spiral from the middle, biggest project first, so the busiest
 * repo lands where you are already looking and quiet ones ring the edge.
 */

// Amazon-flavoured accent palette: the "Smile" orange and Squid Ink lead, with the AWS
// blues, teals and greens filling out the rest so neighbouring zones stay distinguishable.
export const PLOT_PALETTE = [
  0xff9900, 0x146eb4, 0x232f3e, 0x00a1c9, 0x1b8e5a, 0xf2a93b,
  0x2b6cb0, 0x0f7b6c, 0xec7211, 0x37475a, 0x1f9bcf, 0x8c4bce,
]

/** Hex size, centre to corner. Cells tile exactly at this radius. */
const CELL = 7.6
/** Exported for hit-testing: on a hex lattice the nearest cell centre *is* the containing cell. */
export const PLOT_CELL = CELL
/** Pulled in a hair so two neighbouring plots never z-fight along a shared edge. */
const TILE = CELL * 0.992
/**
 * Top face of a plot's tile slab — the surface everything on a plot stands on, and the one
 * height every prop, building, kerb and pair of boots on a plot is measured from.
 *
 * It has to clear the ground it is laid on. Inside the colony the terrain is gentle but not
 * flat: it runs from about -0.3 to +0.24 on the Moon and half again as far on Mars, so the
 * old 0.22 put the top face *level with the high patches* — decks read as sunken, props sat
 * in the ground up to their waists, and every surface that met the terrain tore. This stands
 * the slab proud of the roughest ground any plot can be dealt.
 */
export const DECK_TOP = 0.45
/**
 * How far the slab's underside reaches below y=0.
 *
 * The prism used to stop dead at zero, and zero is *above* the ground over most of a plot:
 * the colony floor bottoms out near -0.36 on the roughest planet, so about three fifths of
 * every plot's edge had open air under it. At the camera's shallowest tilt — six degrees off
 * the horizon — you could see straight through that gap, and even at the resting isometric
 * angle it read as a slab hovering a hand's width off the dirt.
 *
 * Buried by definition, so it only has to reach past the lowest ground a plot can be dealt;
 * it is never the surface anything is measured from. That is still `DECK_TOP`.
 */
const DECK_SKIRT = 0.4
/** The whole prism: the rim you can see, plus the skirt buried under it. */
const DECK_HEIGHT = DECK_TOP + DECK_SKIRT
/** Building slots per cell: one in the middle and six around it. */
const SLOTS_PER_CELL = 7
const MAX_CELLS = 9
/** The lattice cell the ship owns. Nothing else may be placed there. */
const SHIP_CELL = { q: -2, r: 1 }

const HEX_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
]

/**
 * Edge j of a flat-top hexagon runs between the corners at 60j° and 60(j+1)°, so its
 * midpoint faces 60j+30°. This maps that edge to the neighbour sitting across it.
 */
const EDGE_TO_DIR = [0, 5, 4, 3, 2, 1]

const key = (q, r) => `${q},${r}`
const ORIGIN = { q: 0, r: 0 }

/**
 * The live colony grows from ORIGIN with no reserved centre — active zones fill the middle
 * normally (the old central "folder" hub reserve was removed).
 */
/**
 * The parking origin — a second growth centre, set well off to the side, where parked and
 * long-dormant zones cluster (in silver) around a big "P". Its own centre cell is reserved
 * empty (like the old hub) so the "P" marker sits in an open middle with the parked zones
 * ringed around it. Far enough that it reads as a separate lot, not an extension of the colony.
 */
export const PARKING_CELL = { q: 16, r: -4 }
export const parkingWorld = () => hexToWorld(PARKING_CELL.q, PARKING_CELL.r)

/** Flat-top axial hex → world. */
function hexToWorld(q, r, size = CELL) {
  return { x: size * 1.5 * q, z: size * Math.sqrt(3) * (r + q / 2) }
}

/**
 * The inverse: which cell a world point falls in. Exact rather than nearest-centre, because
 * it decides whether something is standing on a plot's raised deck or on bare ground, and a
 * radius test would put an astronaut on a deck it is not actually over.
 */
export function worldToHex(x, z, size = CELL) {
  const q = x / (size * 1.5)
  const r = z / (size * Math.sqrt(3)) - q / 2
  return cubeRound(q, r)
}

/** Round fractional axial coordinates to the cell that actually contains the point. */
function cubeRound(q, r) {
  const y = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const ry = Math.round(y)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const dy = Math.abs(ry - y)
  // Whichever axis drifted furthest is the one recomputed from the other two.
  if (dq > dr && dq > dy) rq = -rr - ry
  else if (dr > dy) rr = -rq - ry
  return { q: rq, r: rr }
}

function hexRing(radius) {
  if (radius === 0) return [{ q: 0, r: 0 }]
  const out = []
  let q = HEX_DIRS[4][0] * radius
  let r = HEX_DIRS[4][1] * radius
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      out.push({ q, r })
      q += HEX_DIRS[i][0]
      r += HEX_DIRS[i][1]
    }
  }
  return out
}

const cellsNeeded = (threadCount) =>
  Math.max(1, Math.min(MAX_CELLS, Math.ceil(threadCount / SLOTS_PER_CELL)))

/** Hex distance in axial coordinates: the cube distance, halved. */
function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2
}

/**
 * Hand out cells to projects, keeping every zone exactly where it already is.
 *
 * This used to be a pure function of the size list, and that was the bug: one thread
 * appearing anywhere changed the order, the order decided the cells, and the whole colony
 * re-laid itself out. A zone you were watching could jump to the far side of the map
 * because a *different* repo gained a session, which makes the place impossible to learn.
 *
 * So the previous layout is an input. A zone that still needs the same number of cells
 * keeps precisely the cells it had; one that grew keeps them and claims neighbours; one
 * that shrank drops the cells it claimed most recently. Only a repo that has never been
 * placed is placed at all, and it takes the innermost cells still free — which is what
 * keeps the busy middle busy.
 *
 * Each list is ordered root-first and growth appends, so a shrink is a slice, and
 * grow-then-shrink puts a zone back in exactly the shape it started in.
 *
 * Contiguity still comes from a flood fill: slicing runs out of a hex spiral looks like it
 * would work and does not, because the last cell of one ring and the first of the next sit
 * on opposite sides of the colony.
 *
 * @param projects [{ id, size }], biggest first — the order only decides who gets the
 *   innermost seed among repos that are *new*.
 * @param previous Map of id → cells from the last pass (or a saved colony file).
 * @returns Map of id → cells.
 */
/**
 * Is the colony one landmass?
 *
 * Every zone is a contiguous blob of its own, but nothing has ever guaranteed the *union* of
 * them is — that held only because zones seed outward in spiral order from the middle, which
 * happens to leave no gaps when everybody who was ever placed is still on the map.
 *
 * Take repos away and the guarantee goes with it. The survivors keep the cells they held in the
 * bigger layout, which is the whole point of the stickiness, but if the zones between them have
 * gone those cells are now islands floating in the sea. That is what folding away dormant repos
 * does the first time it runs.
 *
 * The ship's cell counts as walkable here even though nobody may claim it: a colony that
 * happens to wrap around the ship is not two colonies.
 */
function isConnected(out, projects = []) {
  // The colony is deliberately two landmasses now — the live cluster and the parking lot —
  // so wholeness is checked per region rather than across the whole map. Each region's own
  // cells must form a single connected blob (the ship and hub cells count as stepping
  // stones so a cluster that wraps around them is not read as fragmented).
  const regionOf = new Map(projects.map((p) => [p.id, p.region || 'live']))
  const byRegion = new Map()
  for (const [id, list] of out) {
    const region = regionOf.get(id) || 'live'
    if (!byRegion.has(region)) byRegion.set(region, new Map())
    const m = byRegion.get(region)
    for (const c of list) m.set(key(c.q, c.r), c)
  }
  const steps = new Set([key(SHIP_CELL.q, SHIP_CELL.r), key(PARKING_CELL.q, PARKING_CELL.r)])
  for (const cells of byRegion.values()) {
    if (cells.size < 2) continue
    const passable = new Set([...cells.keys(), ...steps])
    const [start] = cells.keys()
    const seen = new Set([start])
    const queue = [cells.get(start)]
    while (queue.length) {
      const c = queue.pop()
      for (const [dq, dr] of HEX_DIRS) {
        const n = { q: c.q + dq, r: c.r + dr }
        const k = key(n.q, n.r)
        if (!passable.has(k) || seen.has(k)) continue
        seen.add(k)
        queue.push(n)
      }
    }
    for (const s of steps) seen.delete(s)
    if (seen.size !== cells.size) return false
  }
  return true
}

/**
 * @param projects [{ id, size, region }] — `region` is 'parking' for dormant zones, else
 *   they cluster around the hub. Optional; missing means the live cluster.
 */
export function allocateCells(projects, previous = new Map()) {
  const laid = layOut(projects, previous)
  // With two deliberate clusters (live around the hub, dormant in the parking lot) the map
  // is no longer one landmass, so the old contiguity re-lay would fire every pass. Only
  // re-lay when a *cluster* has fragmented into islands — checked per region.
  return isConnected(laid, projects) ? laid : layOut(projects, new Map())
}

/** The growth centre a project spirals out from: the parking lot, or the live colony's ORIGIN. */
function regionOrigin(region) {
  return region === 'parking' ? PARKING_CELL : ORIGIN
}

function layOut(projects, previous) {
  // The ship's cell and the parking lot's centre cell are off-limits to plots. The live
  // colony's centre is NOT reserved any more — active zones fill it normally.
  const reservedCells = new Set([key(SHIP_CELL.q, SHIP_CELL.r), key(PARKING_CELL.q, PARKING_CELL.r)])
  const regionOf = new Map(projects.map((p) => [p.id, p.region || 'live']))
  const wanted = projects.map((p) => ({ id: p.id, want: cellsNeeded(p.size), region: p.region || 'live' }))
  const total = wanted.reduce((n, w) => n + w.want, 0)

  // Spiral order decides where a *new* project settles. The pool runs past what is needed
  // so there is always somewhere to grow into. Built around BOTH growth centres so the
  // parking lot has free ground of its own to spiral into.
  const pool = []
  const free = new Set()
  // The pool has to reach every cell anybody *remembers*, not merely as far as today's
  // colony needs. Sized from `total` alone, a zone that has sat out at ring five for a week
  // finds its own cell missing from `free` the moment the colony shrinks, cannot reclaim
  // it, and is re-seeded in the middle — which is exactly the jump this function exists to
  // prevent, arriving by the back door.
  // Per-region seed pools: cells nearest each growth centre come first, so a new project
  // settles close to its cluster's middle. A cell can belong to only one pool (whichever
  // centre it is nearer), which keeps the two clusters from overlapping.
  const poolFor = { live: [], parking: [] }
  const centres = { live: ORIGIN, parking: PARKING_CELL }
  const added = new Set()
  let farthest = 0
  for (const project of projects) {
    const origin = regionOrigin(project.region)
    for (const cell of previous.get(project.id) || []) farthest = Math.max(farthest, hexDistance(cell, origin))
  }
  const maxRing = Math.min(12, Math.max(6, farthest + 4))
  for (const [region, centre] of Object.entries(centres)) {
    for (let ring = 0; ring <= maxRing; ring++) {
      for (const cell of hexRing(ring)) {
        const c = { q: centre.q + cell.q, r: centre.r + cell.r }
        const k = key(c.q, c.r)
        if (reservedCells.has(k) || added.has(k)) continue
        // A cell claimed by the pool of the centre it is nearer to; ties go to the live hub.
        const nearer = hexDistance(c, centres.live) <= hexDistance(c, centres.parking) ? 'live' : 'parking'
        if (nearer !== region) continue
        added.add(k)
        poolFor[region].push(c)
        pool.push(c)
        free.add(k)
      }
    }
  }

  const held = new Map()
  for (const { id, want } of wanted) {
    const before = previous.get(id)
    if (!before || !before.length) continue
    // The root cell is the whole point — it is the zone's origin, and everything standing
    // on the zone is placed relative to it. A blob that loses its root has *moved*, so if
    // the root is gone this project is seeded afresh rather than quietly re-rooted onto
    // whichever of its old cells happens to still be free.
    if (!free.has(key(before[0].q, before[0].r))) continue
    const keep = []
    for (const cell of before) {
      if (keep.length >= want) break // shrunk: whatever it claimed last is what it gives up
      const k = key(cell.q, cell.r)
      if (!free.has(k)) continue // the ship's cell, or a duplicate in a hand-edited file
      free.delete(k)
      keep.push({ q: cell.q, r: cell.r })
    }
    if (keep.length) held.set(id, keep)
  }

  const out = new Map()
  // Anybody who was already here grows first, so a newcomer cannot take the cell a zone
  // was about to expand into while its own seed is still free.
  for (const { id, want, region } of wanted) {
    const cells = held.get(id)
    if (!cells) continue
    growBlob(cells, want, free, regionOrigin(region))
    out.set(id, cells)
  }

  for (const { id, want, region } of wanted) {
    if (out.has(id)) continue
    // Seed from the project's own region pool, so a dormant zone settles in the parking lot
    // and a live one around the hub.
    const seed = (poolFor[region] || pool).find((c) => free.has(key(c.q, c.r)))
    if (!seed) {
      out.set(id, [])
      continue
    }
    free.delete(key(seed.q, seed.r))
    const cells = [{ q: seed.q, r: seed.r }]
    growBlob(cells, want, free, regionOrigin(region))
    out.set(id, cells)
  }
  return out
}

/** Claim free neighbours until the blob is big enough, hugging its root then its centre. */
function growBlob(cells, want, free, centre = ORIGIN) {
  const root = cells[0]
  while (cells.length < want) {
    let best = null
    let bestScore = Infinity
    for (const c of cells) {
      for (const [dq, dr] of HEX_DIRS) {
        const n = { q: c.q + dq, r: c.r + dr }
        if (!free.has(key(n.q, n.r))) continue
        // Hug the root first, then this cluster's own centre, so blobs come out compact.
        const score = hexDistance(n, root) * 100 + hexDistance(n, centre)
        if (score < bestScore) {
          bestScore = score
          best = n
        }
      }
    }
    if (!best) break // completely hemmed in by neighbours
    free.delete(key(best.q, best.r))
    cells.push(best)
  }
}

export const shipPosition = () => {
  const { x, z } = hexToWorld(SHIP_CELL.q, SHIP_CELL.r)
  return new THREE.Vector3(x, 0, z)
}

/**
 * Three builds a 6-sided cylinder with its first vertex on +Z, which puts its corners at
 * 30°, 90°, 150°… — a *pointy-top* hexagon. The lattice, the edge-to-neighbour mapping and
 * the border bars all assume a **flat-top** hexagon with corners at 0°, 60°, 120°… so every
 * hexagonal prism has to be turned by this much to agree with them. Without it the decks sit
 * a half-step out of phase and their corners poke through the borders.
 */
const HEX_PHASE = Math.PI / 6

/** How many times the deck plate repeats around a tile's rim, at the deck's own scale. */
const PERIMETER_REPEATS = (6 * TILE) / DECK_TEXTURE_SCALE

/** Corner i of a flat-top hexagon, in plot-local coordinates. */
function corner(cx, cz, i, size) {
  const a = (Math.PI / 3) * i
  return [cx + size * Math.cos(a), cz + size * Math.sin(a)]
}

/** A flat-top hexagonal prism, phase-corrected. */
/**
 * Replace a geometry's UVs with a world-planar projection.
 *
 * A hex tile is a six-sided cylinder, and a cylinder's cap UVs are a disc — which turns a
 * tiling plate pattern into a medallion, one per tile. Projecting from XZ instead makes the
 * seams run straight across a whole plot, so seven cells read as one apron rather than seven
 * repeats. Upright faces get the rim treatment: the deck's edge is a shallow band next to
 * the plot it wraps, and a flat XZ projection smears it into streaks at exactly the grazing
 * angle it is seen from.
 *
 * `height` is the prism's own height, which is what the rim's texel density is set against.
 * It is not `DECK_TOP`: the slab reaches below the ground as well as above it, and a rim
 * scaled to only the part you can see would stretch the plate over the part you cannot.
 */
function planarUv(geo, scale, offsetX = 0, offsetZ = 0, height = DECK_TOP) {
  const pos = geo.attributes.position
  const nrm = geo.attributes.normal
  const src = geo.attributes.uv
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (Math.abs(nrm.getY(i)) > 0.5) {
      // Top and bottom: straight down, in world space, so the pattern runs across tiles.
      uv[i * 2] = (x + offsetX) / scale
      uv[i * 2 + 1] = (z + offsetZ) / scale
    } else {
      // The rim keeps the cylinder's own unwrap, only rescaled to world density.
      //
      // Two simpler ideas both fail here. A fixed horizontal axis like `x + z` is *constant*
      // along two of every six sides of a hexagon, which leaves those faces with no UV
      // gradient, a degenerate tangent, and — since three builds the normal-mapped shading
      // frame out of that — solid black. Arc length from `atan2` fixes the gradient but
      // introduces a seam: the face straddling ±π jumps a full turn in one step, crushing a
      // dozen repeats of the texture into one panel, which reads as fine stripes at the
      // corners and as mud once mipmapping averages them. The generated unwrap already
      // solves both, because it duplicates the vertices at the seam.
      uv[i * 2] = src.getX(i) * PERIMETER_REPEATS
      // The cylinder's own v runs 0 at the foot of the prism to 1 at its top, so scaling it
      // by the prism's real height is what keeps the plate at world density whatever the
      // slab's total depth. Lifted off zero so a rim this shallow samples the middle of a
      // plate rather than straddling the seam that runs along the texture's own edge.
      uv[i * 2 + 1] = 0.25 + src.getY(i) * (height / scale)
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/**
 * Point a kerb bar's upper face at the lit dash strip and every other face at plain colour.
 *
 * A box hands all six of its faces the same 0..1 UV square, so one strip drawn once is
 * stretched down the sides and across the ends as well. On a bar 14cm tall that squashes
 * the dark gaps between dashes into what reads as a solid black edge — most visible exactly
 * where two plots meet and six of those edges gather at a corner.
 */
function kerbUv(geo) {
  const nrm = geo.attributes.normal
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) {
    if (nrm.getY(i) > 0.5) {
      uv.setY(i, KERB_UV.top.v0 + uv.getY(i) * (KERB_UV.top.v1 - KERB_UV.top.v0))
    } else {
      uv.setXY(i, KERB_UV.side.u, KERB_UV.side.v)
    }
  }
  uv.needsUpdate = true
}

function hexPrism(radius, height) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 6)
  geo.rotateY(HEX_PHASE)
  return geo
}

// ── plot mesh ─────────────────────────────────────────────────────────────────────────

export class Plot {
  constructor({ id, name, index, cells, accent }) {
    this.id = id
    this.name = name
    this.index = index
    this.cells = cells
    this.accent = accent
    this.cellKeys = new Set(cells.map((c) => key(c.q, c.r)))

    // The plot's origin is its **root** tile — the one it was seeded on and never gives up
    // — rather than the centroid of whatever cells it holds this minute. A zone that gains
    // a tile must not drag its buildings, its crew and its name sideways: the root stays
    // exactly where it was and the new tile appears beside it.
    const origin = hexToWorld(cells[0].q, cells[0].r)
    let sx = 0
    let sz = 0
    this.localCenters = cells.map((c) => {
      const { x, z } = hexToWorld(c.q, c.r)
      sx += x
      sz += z
      return { x: x - origin.x, z: z - origin.z }
    })
    this.center = new THREE.Vector3(origin.x, 0, origin.z)
    // Where the camera aims and where the name plate goes: the middle of the whole zone,
    // so an L-shaped blob is framed as one place rather than from its corner.
    this.middle = new THREE.Vector3(sx / cells.length, 0, sz / cells.length)
    let anchor = this.localCenters[0]
    let anchorD = Infinity
    for (const p of this.localCenters) {
      const dx = p.x - (this.middle.x - origin.x)
      const dz = p.z - (this.middle.z - origin.z)
      const d = dx * dx + dz * dz
      if (d < anchorD) {
        anchorD = d
        anchor = p
      }
    }
    this.labelAnchor = new THREE.Vector3(this.center.x + anchor.x, 0, this.center.z + anchor.z)
    this.radius = CELL * Math.sqrt(cells.length)

    this.group = new THREE.Group()
    this.group.position.copy(this.center)
    this.group.name = `plot:${id}`

    this._buildDeck()
    this._buildBorder()
    this._buildPosts()
    this._buildClutter()
    this.slots = this._buildSlots()
  }

  /** One merged slab of hex tiles. */
  _buildDeck() {
    // UVs are assigned per tile, before it is moved into place: the rim wraps around the
    // tile's own centre, so it has to be at the origin when that is worked out. The top's
    // projection takes the tile's offset explicitly, which keeps the plate pattern running
    // continuously across a whole plot.
    const parts = this.localCenters.map(({ x, z }) => {
      const geo = hexPrism(TILE, DECK_HEIGHT)
      planarUv(geo, DECK_TEXTURE_SCALE, x, z, DECK_HEIGHT)
      // Positioned by its *top* face rather than by its middle: everything on a plot is
      // measured from that face, so it is the end of the prism that has to stay put when
      // the skirt under it changes depth.
      geo.translate(x, DECK_TOP - DECK_HEIGHT / 2, z)
      return geo
    })
    const geo = BufferGeometryUtils.mergeGeometries(parts)
    parts.forEach((g) => g.dispose())

    // Dark and nearly desaturated: the deck is a backdrop for buildings, and the accent
    // belongs on the border where it can outline the zone without shouting. The plate
    // pattern arrives as a texture and this tints it, which is why the drawing is authored
    // neutral grey.
    // Dark, but not black. The deck is a backdrop and wants to sit under the buildings
    // rather than compete with them — but its rim faces sideways, so whatever the top reads
    // as in full sun the edge reads as one stop darker, and a backdrop that goes to nothing
    // at the plot boundary just looks like a hole.
    const color = new THREE.Color(this.accent).offsetHSL(0, -0.38, 0).multiplyScalar(0.9)
    const plate = deckSurface()
    this.deck = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color,
        map: plate.map,
        normalMap: plate.normalMap,
        roughnessMap: plate.roughnessMap,
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: 0.82,
        metalness: 0.18,
      })
    )
    this.deck.receiveShadow = true
    this.group.add(this.deck)
  }

  /**
   * The glowing accent kerb, drawn as one bar per *outside* edge — skipping shared edges is
   * what makes six tiles read as one zone instead of a honeycomb.
   *
   * Two things here exist purely to stop the borders flickering. The bar is inset so it lies
   * wholly **inside** its own tile: centred on the edge it would overlap the neighbouring
   * plot's bar by more than its own width, and two interpenetrating emissive slabs in
   * different colours z-fight along every shared edge in the colony. And it sits **on top of**
   * the deck rather than straddling it, so no two surfaces in a plot are ever coplanar.
   */
  _buildBorder() {
    const parts = []
    const apothem = TILE * Math.cos(Math.PI / 6)
    const width = 0.32
    const inset = 0.05
    // Centreline of the bar, pulled inboard far enough to clear the tile edge entirely.
    const mid = apothem - inset - width / 2
    // The bars form a smaller regular hexagon, whose side equals its own circumradius.
    const side = mid / Math.cos(Math.PI / 6)

    this.cells.forEach((cell, i) => {
      const { x, z } = this.localCenters[i]
      for (let edge = 0; edge < 6; edge++) {
        const dir = HEX_DIRS[EDGE_TO_DIR[edge]]
        if (this.cellKeys.has(key(cell.q + dir[0], cell.r + dir[1]))) continue

        const angle = (Math.PI / 3) * edge + Math.PI / 6
        // Sits on the deck: bottom flush with the deck's top face, never inside it.
        const geo = new THREE.BoxGeometry(width, 0.14, side * 1.02)
        kerbUv(geo)
        geo.rotateY(-angle)
        geo.translate(x + Math.cos(angle) * mid, DECK_TOP + 0.07, z + Math.sin(angle) * mid)
        parts.push(geo)
      }
    })

    if (!parts.length) return
    const geo = BufferGeometryUtils.mergeGeometries(parts)
    parts.forEach((g) => g.dispose())
    // Every bar is the same length, so a box's own 0..1 UVs put the same run of dashes on
    // each one without any reprojection.
    const lit = kerbSurface()
    this.borderMaterial = new THREE.MeshStandardMaterial({
      color: this.accent,
      map: lit.map,
      emissive: this.accent,
      emissiveMap: lit.emissiveMap,
      // Brighter baseline so the zone outline reads clearly by day too, not just at night.
      // Kept thin (see `width` above) — this is glow, not bulk.
      emissiveIntensity: 1.15,
      normalMap: lit.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.55,
      metalness: 0.1,
    })
    this.border = new THREE.Mesh(geo, this.borderMaterial)
    this.border.receiveShadow = true
    this.group.add(this.border)
  }

  /** A lamp post on one corner of each cell — the plot's own night lighting. */
  _buildPosts() {
    const posts = []
    const lamps = []
    this.localCenters.forEach(({ x, z }, i) => {
      const [px, pz] = corner(x, z, (i * 2) % 6, TILE * 0.72)
      const pole = new THREE.CylinderGeometry(0.055, 0.085, 1.8, 6)
      pole.translate(px, DECK_TOP + 0.9, pz)
      posts.push(pole)
      const head = new THREE.SphereGeometry(0.14, 8, 6)
      head.translate(px, DECK_TOP + 1.84, pz)
      lamps.push(head)
    })

    const poleMesh = new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries(posts),
      new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.7, metalness: 0.3 })
    )
    poleMesh.castShadow = true
    this.lampMaterial = new THREE.MeshBasicMaterial({ color: this.accent, toneMapped: true })
    this.lamps = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(lamps), this.lampMaterial)
    this._lampBase = new THREE.Color(this.accent)
    this.group.add(poleMesh, this.lamps)
    posts.forEach((g) => g.dispose())
    lamps.forEach((g) => g.dispose())
  }

  /**
   * Ground clutter — crates, drums and a floodlight or two, hugging the kerb.
   *
   * A plot with buildings on its slots and nothing anywhere else reads as a car park. This
   * fills the gap for one extra draw call: a merged mesh of kit props, placed against the
   * outer edge of each cell where the crew's routes between slots do not run, so nothing
   * has to be added to the navigation grid and nobody ends up walking through a barrel.
   *
   * Seeded off the plot's own name, so a repo's yard is laid out the same on every reload.
   */
  _buildClutter() {
    const props = ['containers_A', 'containers_B', 'containers_C', 'containers_D', 'cargo_A', 'cargo_B', 'cargo_A_packed', 'cargo_B_packed', 'lights']
    if (!props.every((n) => hasPart(n))) return

    const rand = mulberry(hashString(this.id) + 17)
    const parts = []
    /** Plot-local footprints, for the colony to hand to the navigation grid. */
    this.clutterSpots = []

    this.localCenters.forEach(({ x, z }) => {
      // Two bands, both chosen to miss the buildings. The slot ring sits at 0.58 of a tile
      // and a building reaches about 1.5 units past it, so the gaps *between* consecutive
      // ring slots are clear — and so is the strip inside the kerb, past every slot.
      const spots = []
      for (let i = 0; i < 6; i++) {
        if (rand() > 0.45) spots.push({ a: (Math.PI / 3) * i + Math.PI / 3, r: TILE * (0.52 + rand() * 0.1) })
      }
      for (let i = 0; i < 3; i++) {
        if (rand() > 0.35) spots.push({ a: rand() * Math.PI * 2, r: TILE * (0.78 + rand() * 0.07) })
      }

      for (const { a, r } of spots) {
        const name = props[Math.floor(rand() * props.length)]
        const geo = part(name)
        const s = name === 'lights' ? 1.1 : 1.35
        geo.scale(s, s, s)
        geo.rotateY(rand() * Math.PI * 2)
        const px = x + Math.cos(a) * r
        const pz = z + Math.sin(a) * r
        // How much ground this prop actually covers, rather than a guess: a stack of cargo
        // containers is three times the footprint of a lamp, and a radius that splits the
        // difference is one an astronaut walks into the corner of.
        geo.computeBoundingBox()
        const box = geo.boundingBox
        const spread = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5
        geo.translate(px, DECK_TOP, pz)
        parts.push(geo)
        this.clutterSpots.push({ x: px, z: pz, r: Math.max(0.45, spread * 0.86) })
      }
    })

    if (!parts.length) return
    const geo = BufferGeometryUtils.mergeGeometries(parts, false)
    parts.forEach((g) => g.dispose())
    this.clutter = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: atlasTexture(), roughness: 0.6, metalness: 0.05 })
    )
    this.clutter.castShadow = true
    this.clutter.receiveShadow = true
    this.group.add(this.clutter)
  }

  /**
   * Slots, in plot-local coordinates: cell centre first, then the ring around it, cell by
   * cell. Fixed rather than random, so a session keeps its spot as siblings come and go —
   * a building must never jump because a neighbour was archived.
   */
  _buildSlots() {
    const slots = []
    for (const { x, z } of this.localCenters) {
      slots.push({ x, z })
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6
        // Ring pulled inboard (0.50 vs 0.58) so buildings sit clear of the glowing kerb,
        // leaving a visible margin of deck between a building and its zone border.
        slots.push({ x: x + Math.cos(a) * TILE * 0.5, z: z + Math.sin(a) * TILE * 0.5 })
      }
    }
    return slots
  }

  slotFor(index) {
    return this.slots[index % this.slots.length]
  }

  worldSlot(index, out = new THREE.Vector3()) {
    const s = this.slotFor(index)
    return out.set(this.center.x + s.x, DECK_TOP, this.center.z + s.z)
  }

  /** Night lighting, plus a pulse on the border when this plot holds something urgent. */
  setNight(night, urgent, elapsed) {
    if (this.borderMaterial) {
      // Higher daytime floor (1.0) keeps the outline glowing in full sun; night and urgency
      // still push it brighter on top.
      this.borderMaterial.emissiveIntensity =
        1.0 + night * 1.4 + (urgent ? 0.4 + Math.sin(elapsed * 3.4) * 0.32 : 0)
    }
    this.lampMaterial.color.copy(this._lampBase).multiplyScalar(0.5 + night * 2.4)
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
  }
}

// ── labels ────────────────────────────────────────────────────────────────────────────

/**
 * Each harness gets a small brand badge before the name — a rounded square in the tool's
 * colour with its initial — so you can tell at a glance whether a zone's work runs in Claude,
 * Kiro, Codex or Cursor. Falls back to a neutral badge for anything unrecognised.
 */
const HARNESS_BADGE = {
  'claude-code': { bg: '#d97757', fg: '#ffffff', letter: 'C' }, // Claude terracotta
  kiro: { bg: '#7c5cff', fg: '#ffffff', letter: 'K' }, // Kiro violet
  codex: { bg: '#111111', fg: '#ffffff', letter: 'O' }, // Codex / OpenAI black
  cursor: { bg: '#efe9df', fg: '#111111', letter: 'C' }, // Cursor light
}

/**
 * Project name plates. Drawn to a canvas once per project and billboarded in the vertex
 * shader, so they stay upright and legible from any camera angle without a per-frame
 * lookAt on the CPU. A tool badge (`harness`) sits before the name in place of the old dot.
 */
export function createLabel(text, accent, harness = '', pixelRatio = 4) {
  const fontSize = 34
  const font = `500 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  const badgeSize = 26 // the rounded-square tool icon
  const gap = 12
  const pad = 14
  const badge = HARNESS_BADGE[harness] || { bg: '#' + new THREE.Color(accent).getHexString(), fg: '#ffffff', letter: '' }

  const measure = document.createElement('canvas').getContext('2d')
  measure.font = font
  const textWidth = Math.ceil(measure.measureText(text).width)

  const canvas = document.createElement('canvas')
  const w = textWidth + badgeSize + gap + pad * 2
  const h = fontSize + pad * 2
  canvas.width = Math.ceil(w * pixelRatio)
  canvas.height = Math.ceil(h * pixelRatio)
  const c = canvas.getContext('2d')
  c.scale(pixelRatio, pixelRatio)

  // No plate and no outline — legibility comes from a soft dark halo behind the glyphs,
  // which sits on grass, regolith or rust equally well and disappears the moment you stop
  // reading it. A small tool badge is what ties the name to the harness its work runs in.
  c.font = font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  const textX = pad + badgeSize + gap
  const midY = h / 2

  // Halo behind the text.
  c.shadowColor = 'rgba(0,0,0,0.85)'
  c.shadowBlur = 9
  c.fillStyle = 'rgba(0,0,0,0.9)'
  for (let i = 0; i < 3; i++) c.fillText(text, textX, midY)
  c.shadowBlur = 0

  // The tool badge: a rounded square in the tool's colour with its initial.
  const bx = pad
  const by = midY - badgeSize / 2
  const r = 7
  c.shadowColor = 'rgba(0,0,0,0.55)'
  c.shadowBlur = 6
  c.fillStyle = badge.bg
  c.beginPath()
  c.moveTo(bx + r, by)
  c.arcTo(bx + badgeSize, by, bx + badgeSize, by + badgeSize, r)
  c.arcTo(bx + badgeSize, by + badgeSize, bx, by + badgeSize, r)
  c.arcTo(bx, by + badgeSize, bx, by, r)
  c.arcTo(bx, by, bx + badgeSize, by, r)
  c.closePath()
  c.fill()
  c.shadowBlur = 0
  if (badge.letter) {
    c.fillStyle = badge.fg
    c.font = `700 ${Math.round(badgeSize * 0.68)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
    c.textAlign = 'center'
    c.fillText(badge.letter, bx + badgeSize / 2, midY + 1)
    c.textAlign = 'left'
    c.font = font
  }

  // The name itself.
  c.fillStyle = '#f4f2ee'
  c.fillText(text, textX, midY)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // A plate holds a near-constant screen size, so it is *magnified* when you lean in and
  // *minified* when you pull out, and it has to survive both: the pixel ratio covers the
  // close end, mipmaps the far one. Without them a distant name crawls with aliasing.
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8

  const height = 0.56
  const geo = new THREE.PlaneGeometry(height * (w / h), height)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    // A name plate is a label on the world rather than an object in it: it floats above its
    // zone, so a habitat between it and the camera used to cut the name in half. Like the
    // badges, it is drawn on top of the scene and ordered against them — badges come last,
    // because the one that wants you matters more than the zone it is standing in.
    depthTest: false,
    toneMapped: false,
    opacity: 0,
  })
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
       float dist = -mvPosition.z;
       mvPosition.xy += position.xy * ( 0.55 + dist * 0.03 );
       gl_Position = projectionMatrix * mvPosition;`
    )
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 8
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.userData.dispose = () => {
    texture.dispose()
    geo.dispose()
    mat.dispose()
  }
  return mesh
}

/**
 * The parking-lot landmark: a road parking sign — a blue "P" on a white upward triangle —
 * billboarded like a name plate so it always faces the camera. Marks the open centre of the
 * parking cluster.
 */
export function createParkingSign(pixelRatio = 4) {
  const S = 128 // canvas is square; the triangle is inscribed in it
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S * pixelRatio
  const c = canvas.getContext('2d')
  c.scale(pixelRatio, pixelRatio)

  // A soft dark halo so the sign reads on any ground, same trick the name plates use.
  c.shadowColor = 'rgba(0,0,0,0.55)'
  c.shadowBlur = 10

  // White upward-pointing triangle with rounded corners.
  const cx = S / 2
  const top = S * 0.1
  const bottom = S * 0.9
  const halfBase = S * 0.42
  c.fillStyle = '#f7f8fa'
  c.beginPath()
  c.moveTo(cx, top)
  c.lineTo(cx + halfBase, bottom)
  c.lineTo(cx - halfBase, bottom)
  c.closePath()
  c.fill()
  c.shadowBlur = 0

  // A thin blue rim reads as a proper sign rather than a plain shape.
  c.strokeStyle = '#0b5fb0'
  c.lineWidth = 5
  c.lineJoin = 'round'
  c.stroke()

  // The blue "P", weighted low so it centres in the triangle's mass rather than its height.
  c.fillStyle = '#146eb4'
  c.font = `800 ${Math.round(S * 0.42)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText('P', cx, S * 0.62)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8

  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    opacity: 0,
  })
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
       float dist = -mvPosition.z;
       mvPosition.xy += position.xy * ( 0.55 + dist * 0.03 );
       gl_Position = projectionMatrix * mvPosition;`
    )
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 8
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.userData.dispose = () => {
    texture.dispose()
    geo.dispose()
    mat.dispose()
  }
  return mesh
}

export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
