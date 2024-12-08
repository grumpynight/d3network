// Initialize all global variables first
const width = window.innerWidth;
const height = window.innerHeight;
let nodes = [];
let links = [];
let node, link, labelGroups;
let simulation;
let validNodeNames = new Set();
let drag; // Declare drag variable

// SVG setup
const svg = d3.select("svg")
    .attr("width", width)
    .attr("height", height);

// Initialize zoom behavior
const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on("zoom", zoomed);

// Create container for zoom
const container = svg.append("g");
const labelContainer = container.append("g");

// Apply zoom to SVG
svg.call(zoom);

function zoomed(event) {
    container.attr("transform", event.transform);
}

// Separate function for data processing
function processData(pointsText, linksText) {
    const pointsLines = pointsText.split('\n').filter(line => line.trim());
    console.log("Number of points:", pointsLines.length);

    // Process nodes
    nodes = pointsLines.map(line => {
        const [name, image] = line.split('\t');
        validNodeNames.add(name);
        return { id: name, name: name, image: image };
    });

    // Process links
    const linksLines = linksText.split('\n').filter(line => line.trim());
    links = linksLines.map(line => {
        const [source, target, relationship, type] = line.split('\t');
        return { source, target, relationship, type };
    }).filter(link => {
        const isValid = validNodeNames.has(link.source) && validNodeNames.has(link.target);
        if (!isValid) {
            console.warn('Skipping invalid link:', link);
        }
        return isValid;
    });

    // Initialize simulation
    simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links)
            .id(d => d.id)
            .distance(500)
            .strength(0.2))
        .force("charge", d3.forceManyBody()
            .strength(-2000)
            .distanceMin(200))
        .force("collision", d3.forceCollide()
            .radius(150)
            .strength(0.5))
        .alpha(0.7)
        .alphaDecay(0.002)
        .velocityDecay(0.2);

    // Initialize drag behavior after simulation exists
    drag = d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);

    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    console.log("Processed nodes:", nodes);
    console.log("Processed links:", links);
    
    // Create visualization elements here
    createVisualization();
}

function createVisualization() {
    // Create links
    link = container.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("class", d => `relationship-${d.type}`);

    // Create nodes
    const nodeGroup = container.append("g")
        .attr("class", "nodes");

    // Create labels container first
    labelGroups = labelContainer.selectAll("g")
        .data(nodes)
        .join("g")
        .attr("class", "label-group");

    labelGroups.append("text")
        .attr("class", "node-label")
        .text(d => d.name)
        .attr("text-anchor", "middle")
        .attr("dy", "40");

    // Create nodes with updated event handlers
    node = nodeGroup
        .selectAll("g")
        .data(nodes)
        .join("g")
        .attr("class", "node")
        .on("mouseover", function(event, d) {
            // Get connected nodes
            const connectedNodes = new Set([d.id]);
            links.forEach(link => {
                if (link.source.id === d.id) connectedNodes.add(link.target.id);
                if (link.target.id === d.id) connectedNodes.add(link.source.id);
            });

            // Update visibility
            labelGroups.classed("visible", n => connectedNodes.has(n.id));
            
            // Update node and link highlighting
            node.classed("highlighted", n => connectedNodes.has(n.id))
                .classed("faded", n => !connectedNodes.has(n.id));
            
            link.classed("highlighted", l => l.source.id === d.id || l.target.id === d.id)
                .classed("faded", l => l.source.id !== d.id && l.target.id !== d.id);
        })
        .on("mouseout", function() {
            // Reset all states
            labelGroups.classed("visible", false);
            node.classed("highlighted", false)
                .classed("faded", false);
            link.classed("highlighted", false)
                .classed("faded", false);
        });

    // Add images to nodes
    node.append("image")
        .attr("xlink:href", d => d.image)
        .attr("width", 160)
        .attr("height", 160)
        .attr("x", -80)
        .attr("y", -80)
        .attr("class", "node-image")
        .attr("preserveAspectRatio", "xMidYMid slice")
        .attr("clip-path", (d, i) => `url(#circle-clip-${i})`);

    // Add clip paths
    node.append("clipPath")
        .attr("id", (d, i) => `circle-clip-${i}`)
        .append("circle")
        .attr("r", 80);

    // Add border circles
    node.append("circle")
        .attr("r", 80)
        .attr("class", "node-circle");

    // Add drag behavior
    node.call(drag);

    // Update the simulation's tick handler
    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("transform", d => `translate(${d.x},${d.y})`);

        // Update label positions
        labelGroups.attr("transform", d => {
            const pos = calculateLabelPosition(d, nodes, []);
            return `translate(${d.x + pos.x},${d.y + pos.y})`;
        });
    });
}

// Load and process data from GitHub
Promise.all([
    d3.text('./Points.txt'),
    d3.text('./Links.txt')
]).then(function([pointsText, linksText]) {
    processData(pointsText, linksText);
}).catch(error => {
    console.error("Error loading or processing data:", error);
});

// Helper functions
function calculateLabelPosition(d, nodes, existingLabels) {
    const nodeRadius = 80;
    const labelHeight = 20;
    const verticalPadding = -5;
    
    const basePosition = {
        x: 0,
        y: nodeRadius + verticalPadding
    };

    const labelX = d.x + basePosition.x;
    const labelY = d.y + basePosition.y;
    const newLabelRect = getLabelRect(labelX, labelY);

    let hasOverlap = existingLabels.some(existing => 
        doLabelsOverlap(newLabelRect, existing)
    );

    if (!hasOverlap) {
        existingLabels.push(newLabelRect);
        return basePosition;
    }

    for (let offset = -5; offset <= 5; offset += 5) {
        if (offset === 0) continue;

        const testPos = {
            x: basePosition.x,
            y: basePosition.y + offset
        };

        const testX = d.x + testPos.x;
        const testY = d.y + testPos.y;
        const testRect = getLabelRect(testX, testY);

        hasOverlap = existingLabels.some(existing => 
            doLabelsOverlap(testRect, existing)
        );

        if (!hasOverlap) {
            existingLabels.push(testRect);
            return testPos;
        }
    }

    return {
        x: basePosition.x,
        y: basePosition.y + 5
    };
}

function getLabelRect(x, y, width = 100, height = 20) {
    return {
        x: x - width/2,
        y: y,
        width: width,
        height: height
    };
}

function doLabelsOverlap(rect1, rect2, padding = 5) {
    return !(rect1.x + rect1.width + padding < rect2.x || 
            rect1.x > rect2.x + rect2.width + padding || 
            rect1.y + rect1.height + padding < rect2.y || 
            rect1.y > rect2.y + rect2.height + padding);
}

// Add search functionality
const searchInput = document.querySelector('.search-input');
const searchResults = document.querySelector('.search-results');
let currentSuggestions = [];
let selectedIndex = -1;

searchInput.addEventListener('input', (e) => {
    const value = e.target.value.toLowerCase();
    if (!value) {
        searchResults.style.display = 'none';
        currentSuggestions = [];
        selectedIndex = -1;
        return;
    }

    currentSuggestions = nodes
        .filter(node => node.name.toLowerCase().includes(value))
        .slice(0, 5);

    if (currentSuggestions.length > 0) {
        selectedIndex = -1;
        renderSuggestions();
        searchResults.style.display = 'block';
    } else {
        searchResults.style.display = 'none';
    }
});

// Keyboard navigation
searchInput.addEventListener('keydown', (e) => {
    if (!currentSuggestions.length) return;

    switch(e.key) {
        case 'ArrowDown':
            e.preventDefault();
            selectedIndex = selectedIndex < currentSuggestions.length - 1 ? selectedIndex + 1 : 0;
            renderSuggestions();
            highlightSelected();
            break;
        case 'ArrowUp':
            e.preventDefault();
            selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : currentSuggestions.length - 1;
            renderSuggestions();
            highlightSelected();
            break;
        case 'Enter':
            e.preventDefault();
            if (selectedIndex >= 0) {
                selectNode(currentSuggestions[selectedIndex]);
            } else if (currentSuggestions.length > 0) {
                selectNode(currentSuggestions[0]);
            }
            break;
    }
});

function highlightSelected() {
    const items = searchResults.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
        if (index === selectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function renderSuggestions() {
    searchResults.innerHTML = currentSuggestions
        .map((node, index) => `
            <div class="search-result-item${index === selectedIndex ? ' selected' : ''}"
                 data-index="${index}">
                ${node.name}
            </div>
        `).join('');
}

// Mouse hover handler
searchResults.addEventListener('mousemove', (e) => {
    if (e.target.classList.contains('search-result-item')) {
        selectedIndex = parseInt(e.target.dataset.index);
        renderSuggestions();
    }
});

// Click handler
searchResults.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('search-result-item')) {
        const selectedName = e.target.textContent.trim();
        const selectedNode = nodes.find(n => n.name === selectedName);
        if (selectedNode) {
            selectNode(selectedNode);
        }
    }
});

// Handle blur event
searchInput.addEventListener('blur', (e) => {
    setTimeout(() => {
        searchResults.style.display = 'none';
    }, 200);
});

function selectNode(node) {
    // Highlight the node and its connections
    highlightNodeAndConnections(node);
    
    // Center the view on the node
    centerOnNode(node);
    
    // Update search input and hide results
    searchInput.value = node.name;
    searchResults.style.display = 'none';
    selectedIndex = -1;
    
    // Clear the search input after a short delay
    setTimeout(() => {
        searchInput.value = '';
    }, 1500);
    
    // Ensure labels stay visible for selected node and its connections
    const connectedNodes = new Set();
    links.forEach(link => {
        if (link.source.id === node.id) connectedNodes.add(link.target.id);
        if (link.target.id === node.id) connectedNodes.add(link.source.id);
    });

    labelGroups
        .classed("visible", n => n.id === node.id || connectedNodes.has(n.id));
}

function centerOnNode(selectedNode) {
    // Only apply mobile-specific zoom behavior if on mobile
    const isMobile = window.innerWidth < 768;
    
    // Get current viewport dimensions
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

    // Find all connected nodes
    const connectedNodes = new Set([selectedNode]);
    links.forEach(link => {
        if (link.source.id === selectedNode.id) {
            connectedNodes.add(link.target);
        } else if (link.target.id === selectedNode.id) {
            connectedNodes.add(link.source);
        }
    });

    if (isMobile) {
        // Calculate the bounding box for mobile view
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        connectedNodes.forEach(node => {
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
        });

        // Add more padding for mobile
        const padding = Math.min(vw, vh) * 0.15; // 15% of viewport
        minX -= padding;
        maxX += padding;
        minY -= padding;
        maxY += padding;

        // Calculate required scale for mobile
        const boxWidth = maxX - minX;
        const boxHeight = maxY - minY;
        const scale = Math.min(
            vw / boxWidth,
            vh / boxHeight,
            1.5  // Lower maximum zoom level for mobile
        ) * 0.9; // Slightly reduce scale

        // Calculate center
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Calculate translation
        const x = vw/2 - centerX * scale;
        const y = vh/2 - centerY * scale;

        // Animate to the new view
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity
                .translate(x, y)
                .scale(scale));
    } else {
        // Desktop behavior - center on node without extreme zoom
        const scale = d3.zoomTransform(svg.node()).k; // maintain current scale
        const x = vw/2 - selectedNode.x * scale;
        const y = vh/2 - selectedNode.y * scale;

        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity
                .translate(x, y)
                .scale(scale));
    }
}

function highlightNodeAndConnections(d) {
    const connectedNodes = new Set([d.id]);
    links.forEach(link => {
        if (link.source.id === d.id) connectedNodes.add(link.target.id);
        if (link.target.id === d.id) connectedNodes.add(link.source.id);
    });

    // Force label visibility
    labelGroups.each(function(n) {
        d3.select(this)
            .classed("visible", connectedNodes.has(n.id))
            .select(".node-label")
            .style("opacity", connectedNodes.has(n.id) ? 1 : 0);
    });

    node.classed("highlighted", n => connectedNodes.has(n.id))
        .classed("faded", n => !connectedNodes.has(n.id));

    link.classed("highlighted", l => l.source.id === d.id || l.target.id === d.id)
        .classed("faded", l => l.source.id !== d.id && l.target.id !== d.id);
}