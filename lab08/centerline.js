function drawPerimeter(path) {
    // More points = more precision + more compute time
    svg = d3.select(path.parentNode);
    console.log(svg)
    const numPoints = 300;

    const length = path.getTotalLength();

    const polygon = d3
        .range(numPoints)
        .map(i => path.getPointAtLength(length * i / numPoints))
        .map(d => [d.x, d.y]);

    const dots = svg
        .append('g')
        .attr("class", "points")
        .attr("style", "transform:translate(0,1024px) scale(1,-1);")
        .selectAll("circle")
        .data(polygon)
        .enter()
        .append("circle")
        .call(drawCircle);

    return polygon;
}

// Get the voronoi edges for the perimeter points
function drawVoronoi(polygon) {
    const [x0, x1] = d3.extent(polygon.map(d => d[0])),
        [y0, y1] = d3.extent(polygon.map(d => d[1]));

    const voronoi = d3.voronoi().extent([[x0 - 1, y0 - 1], [x1 + 1, y1 + 1]])(polygon);

    const edges = voronoi.edges.filter(edge => {
        if (edge && edge.right) {
            const inside = edge.map(point => d3.polygonContains(polygon, point));
            if (inside[0] === inside[1]) {
                return inside[0];
            }
            if (inside[1]) {
                edge.reverse();
            }
            return true;
        }
        return false;
    });
    svg
        .append('g')
        .attr("style", "transform:translate(0,1024px) scale(1,-1);")
        .attr("class", "edges")
        .selectAll(".edge")
        .data(edges)
        .enter()
        .append("line")
        .attr("class", "edge")
        .call(drawLineSegment);

    return { polygon, edges };
}

// Clip the Voronoi edges to the polygon
function clipVoronoi({ polygon, edges }) {
    edges.forEach(edge => {
        const [start, end] = edge;

        const { intersection, distance } = polygon.reduce((best, point, i) => {
            const intersection = findIntersection(start, end, point, polygon[i + 1] || polygon[0]);
            if (intersection) {
                const distance = distanceBetween(start, intersection);
                if (!best.distance || distance < best.distance) {
                    return { intersection, distance };
                }
            }
            return best;
        }, {});

        if (intersection) {
            edge[1] = intersection;
            edge.distance = distance;
            edge[1].clipped = true;
        } else {
            edge.distance = distanceBetween(start, end);
        }
    });

    svg
        .append("g")
        .attr("class", "clips")
        .attr("style", "transform:translate(0,1024px) scale(1,-1);")
        .selectAll(".clipped")
        .data(edges)
        .enter()
        .append("line")
        .attr("class", "clipped")
        .call(drawLineSegment);

    return edges;
}

// Construct a graph of the clipped edges
// For each pair of points, use Dijkstra's algorithm to find the shortest path
// We want the "longest shortest path" as the centerline
function findCenterline(edges) {
    const nodes = [];

    // Create links between Voronoi nodes in the least efficient way possible
    edges.forEach(edge => {
        edge.forEach((node, i) => {
            if (!i || !node.clipped) {
                const match = nodes.find(d => d === node);
                if (match) {
                    return (node.id = match.id);
                }
            }
            node.id = nodes.length.toString();
            node.links = {};
            nodes.push(node);
        });
        edge[0].links[edge[1].id] = edge.distance;
        edge[1].links[edge[0].id] = edge.distance;
    });

    const graph = new Graph();

    nodes.forEach(node => {
        graph.addNode(node.id, node.links);
    });

    const perimeterNodes = nodes.filter(d => d.clipped);

    const longestShortest = perimeterNodes
        .reduce((totalBest, start, i) => {
            // Check all nodes above index i to avoid doubling up
            const path = perimeterNodes.slice(i + 1).reduce((nodeBest, node) => {
                const path = graph.path(node.id, start.id, { cost: true });
                if (!nodeBest.cost || path.cost > nodeBest.cost) {
                    return path;
                }
                return nodeBest;
            }, {});

            if (!totalBest.cost || path.cost > totalBest.cost) {
                return path;
            }
            return totalBest;
        }, {})
        .path.map(id => nodes[+id]);

    svg
        .append("path")
        .attr("class", "longest")
        .attr("style","transform:translate(0,1024px) scale(1,-1);")
        .attr("d", d3.line()(longestShortest));

    return longestShortest;
}

// Simplify the centerline and smooth it with a basis spline
// Check a few tangents near the middle to guess orientation
// If the line is going generally right-to-left, flip it
function simplifyCenterline(centerline) {
    centerline = simplify(centerline.map(d => ({ x: d[0], y: d[1] })), 8).map(d => [d.x, d.y]);

    const smoothLine = d3.line().curve(d3.curveBasis);

    svg
        .append("path")
        .attr("id", "centerline")
        .attr("style","transform:translate(0,1024px) scale(1,-1);")
        .attr("d", smoothLine(centerline))
        .each(function (d) {
            // Try to pick the right text orientation based on whether
            // the middle of the centerline is rtl or ltr
            const len = this.getTotalLength(),
                tangents = [
                    tangentAt(this, len / 2),
                    tangentAt(this, len / 2 - 50),
                    tangentAt(this, len + 50)
                ];

            if (tangents.filter(t => Math.abs(t) > 10).length > tangents.length / 2) {
                centerline.reverse();
            }
        })
        .attr("d", smoothLine(centerline));
}

// Draw a label at the middle of the smoothed centerline
function addLabel() {
    svg
        .append("text")
        .attr("dy", "0.35em")
        .append("textPath")
        .attr("xlink:href", "#centerline")
        .attr("startOffset", "50%")
        .attr("text-anchor", "middle")
        .text("A RATHER CURVED LABEL");
}

// Cycling through the layers for illustration purposes
function animate() {
    const steps = [
        null,
        "circle",
        "circle, .edge",
        ".clipped",
        ".clipped, .longest",
        ".longest",
        "#centerline",
        "#centerline, text",
        "text"
    ];

    advance();
    function advance() {
        svg.selectAll("path, circle, line, text").style("display", "none");

        if (steps[0]) {
            svg.selectAll(steps[0]).style("display", "block");
        }

        steps.push(steps.shift());

        setTimeout(advance, steps[0] ? 750 : 2000);
    }
}

function drawCircle(sel) {
    sel
        .attr("cx", d => d[0])
        .attr("cy", d => d[1])
        .attr("r", 2.5);
}

function drawLineSegment(sel) {
    sel
        .attr("x1", d => d[0][0])
        .attr("x2", d => d[1][0])
        .attr("y1", d => d[0][1])
        .attr("y2", d => d[1][1]);
}

// From https://github.com/Turfjs/turf-line-slice-at-intersection
function findIntersection(a1, a2, b1, b2) {
    const uaT = (b2[0] - b1[0]) * (a1[1] - b1[1]) - (b2[1] - b1[1]) * (a1[0] - b1[0]),
        ubT = (a2[0] - a1[0]) * (a1[1] - b1[1]) - (a2[1] - a1[1]) * (a1[0] - b1[0]),
        uB = (b2[1] - b1[1]) * (a2[0] - a1[0]) - (b2[0] - b1[0]) * (a2[1] - a1[1]);

    if (uB !== 0) {
        const ua = uaT / uB,
            ub = ubT / uB;
        if (ua > 0 && ua < 1 && ub > 0 && ub < 1) {
            return [a1[0] + ua * (a2[0] - a1[0]), a1[1] + ua * (a2[1] - a1[1])];
        }
    }
}

function tangentAt(el, len) {
    const a = el.getPointAtLength(Math.max(len - 0.01, 0)),
        b = el.getPointAtLength(len + 0.01);

    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

function distanceBetween(a, b) {
    const dx = a[0] - b[0],
        dy = a[1] - b[1];

    return Math.sqrt(dx * dx + dy * dy);
}