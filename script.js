class Item {
  constructor(name, itemId, quantity) {
    this.name = name;
    this.itemId = itemId;
    this.quantity = quantity;
    this.listings = new Map(); // datacenter -> world -> price[]
  }

  addListing(datacenter, world, price) {
    if (!this.listings.has(datacenter)) {
      this.listings.set(datacenter, new Map());
    }
    if (!this.listings.get(datacenter).has(world)) {
      this.listings.get(datacenter).set(world, []);
    }
    this.listings.get(datacenter).get(world).push(price);
  }
}

class MarketShopper {
  constructor() {
    this.datacenters = ["Aether", "Crystal", "Primal", "Dynamis", "Chaos", "Light", "Materia", "Elemental", "Gaia", "Mana", "Meteor"];
    this.initializeUI();
    this.loadingOverlay = document.getElementById("loadingOverlay");
    this.npcItems = null;
    this.itemNames = null;
    this.loadNpcItems();
    this.loadItemNames();
    
    // Grand Company item ranges (sets of 72 items each)
    this.gcItemRanges = [
      { start: 42870, end: 42946 }, // archeo kingdom
      { start: 39630, end: 39703 }, // diadochos
      { start: 37742, end: 37815 }, // rinascita
      { start: 35020, end: 35093 }, // classical
      { start: 31813, end: 31886 },
      { start: 29404, end: 29477 },
      { start: 26428, end: 26501 }, // facet
      { start: 23768, end: 23841 },
      { start: 21695, end: 21768 }, // nightsteel
      { start: 18969, end: 19042 }  // chromite
    ];
  }

  initializeUI() {
    const checkboxContainer = document.getElementById("datacenterCheckboxes");
    this.datacenters.forEach((dc) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = dc;
      checkbox.name = "datacenter";
      checkbox.checked = true; // Make checked by default
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(dc));
      checkboxContainer.appendChild(label);
    });

    // Add optimization controls
    const optimizeContainer = document.createElement("div");
    optimizeContainer.className = "optimize-controls";
    optimizeContainer.innerHTML = `
      <div class="optimize-option">
        <label>
          <input type="checkbox" id="optimizeTravel" />
          Optimize Travel
        </label>
        <div class="optimize-details">
          <label>For items costing more than <input type="number" id="gilThreshold" value="5000" min="1" style="width: 80px;"> gil, 
          only travel to another world if the price difference is more than 
          <input type="number" id="priceThreshold" value="5" min="1" max="100" style="width: 60px;"> % 
          of the item's price</label>
          <p class="help-text">
            Example: For an item that costs 1,000 gil, it will stay in the same world regardless of price difference 
            since it's below 5,000 gil. For an item that costs 10,000 gil, it will only check other worlds 
            if the price difference is more than 5%.
          </p>
        </div>
      </div>
    `;
    document.querySelector(".region-select").appendChild(optimizeContainer);

    document.getElementById("processButton").addEventListener("click", () => this.processFile());
    document.getElementById("sealProcessButton").addEventListener("click", () => this.processSealShopping());
    
    // Add file input visual feedback
    document.getElementById("fileInput").addEventListener("change", (e) => {
      const label = document.getElementById("fileInputLabel");
      if (e.target.files.length > 0) {
        label.textContent = `✅ ${e.target.files[0].name}`;
        label.classList.add("file-selected");
      } else {
        label.textContent = "📁 Choose JSON File";
        label.classList.remove("file-selected");
      }
    });
    
    // Add mode toggle listeners
    document.querySelectorAll('input[name="shoppingMode"]').forEach(radio => {
      radio.addEventListener("change", (e) => {
        const isNormalMode = e.target.value === "normal";
        document.getElementById("normalModeUI").style.display = isNormalMode ? "block" : "none";
        document.getElementById("sealModeUI").style.display = isNormalMode ? "none" : "block";
        document.querySelector(".optimize-controls").style.display = isNormalMode ? "block" : "none";
        document.getElementById("makeplaceDescription").style.display = isNormalMode ? "block" : "none";
        document.getElementById("sealDescription").style.display = isNormalMode ? "none" : "block";
        document.getElementById("output").innerHTML = "";
      });
    });
  }

  showLoading() {
    this.loadingOverlay.style.display = "flex";
    document.body.style.overflow = "hidden"; // Prevent scrolling while loading
  }

  hideLoading() {
    this.loadingOverlay.style.display = "none";
    document.body.style.overflow = ""; // Restore scrolling
  }

  async processFile() {
    const fileInput = document.getElementById("fileInput");
    const file = fileInput.files[0];
    const selectedDatacenters = Array.from(document.querySelectorAll('input[name="datacenter"]:checked')).map((cb) => cb.value);

    if (!file) {
      alert("Please upload a JSON file");
      return;
    }
    if (selectedDatacenters.length === 0) {
      alert("Please select at least one data center");
      return;
    }

    try {
      this.showLoading();
      const data = await this.readFile(file);
      const { marketItems, npcItems } = this.parseItems(data);
      const results = await this.fetchPrices(marketItems, selectedDatacenters);
      this.displayResults({ ...results, npcItems });
    } catch (error) {
      console.error("Error processing file:", error);
      alert("Error processing file. Please check console for details.");
    } finally {
      this.hideLoading();
    }
  }

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(JSON.parse(e.target.result));
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }

  parseItems(data) {
    const items = new Map();
    const npcItems = new Map();

    const addItem = (furniture) => {
      const id = furniture.itemId;
      const isNpcItem = this.isNpcItem(furniture.name);

      const targetMap = isNpcItem ? npcItems : items;

      if (targetMap.has(id)) {
        targetMap.get(id).quantity += 1;
      } else {
        targetMap.set(id, new Item(furniture.name, id, 1));
      }

      // Recursively add attachments if they exist
      if (furniture.attachments && Array.isArray(furniture.attachments)) {
        furniture.attachments.forEach((attachment) => addItem(attachment));
      }
    };

    // Process interior furniture
    data.interiorFurniture.forEach(addItem);

    // Process fixtures (only Light, Floor, Wall)
    data.interiorFixture.filter((f) => ["Light", "Floor", "Wall"].includes(f.type)).forEach(addItem);

    return { marketItems: items, npcItems: npcItems };
  }

  isNpcItem(itemName) {
    for (const [vendor, categories] of Object.entries(this.npcItems)) {
      if (categories.items) {
        // Direct items array
        const item = categories.items.find((item) => item.name === itemName);
        if (item) return { vendor, price: item.price };
      } else {
        // Categorized items
        for (const category of Object.values(categories)) {
          const item = category.items.find((item) => item.name === itemName);
          if (item) return { vendor, price: item.price };
        }
      }
    }
    return false;
  }

  async fetchPrices(items, datacenters) {
    const results = new Map();
    const itemIds = Array.from(items.keys()).join(",");
    const maxQuantity = Math.max(...Array.from(items.values()).map((item) => item.quantity));

    // Rate limiting settings
    const MAX_CONCURRENT = 8; // Maximum concurrent connections
    const RATE_LIMIT = 25; // Requests per second
    const MIN_DELAY = 1000 / RATE_LIMIT; // Minimum delay between requests in ms

    // Create chunks of datacenters to process concurrently
    const chunks = [];
    for (let i = 0; i < datacenters.length; i += MAX_CONCURRENT) {
      chunks.push(datacenters.slice(i, i + MAX_CONCURRENT));
    }

    // Process each chunk of datacenters
    for (const chunk of chunks) {
      // Create an array of promises for the current chunk
      const promises = chunk.map(async (dc) => {
        const url = `https://universalis.app/api/v2/${dc}/${itemIds}?listings=${maxQuantity}&entries=0`;
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();
          results.set(dc, data);
        } catch (error) {
          console.error(`Error fetching data for ${dc}:`, error);
        }

        // Add delay between requests
        await new Promise((resolve) => setTimeout(resolve, MIN_DELAY));
      });

      // Wait for all promises in the current chunk to complete
      await Promise.all(promises);

      // Add additional delay between chunks to ensure we stay under rate limit
      if (chunks.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, MIN_DELAY * 2));
      }
    }

    // Process all listings to find best prices
    if (document.getElementById("optimizeTravel").checked) {
      return this.optimizeForTravel(items, results);
    } else {
      return this.findCheapestPrices(items, results);
    }
  }

  findCheapestPrices(items, results) {
    const bestPrices = new Map();

    items.forEach((item, itemId) => {
      const allListings = [];

      // Gather all listings
      results.forEach((data, datacenter) => {
        if (data.items[itemId]?.listings) {
          data.items[itemId].listings.forEach((listing) => {
            allListings.push({
              price: listing.pricePerUnit,
              world: listing.worldName,
              datacenter: datacenter,
            });
          });
        }
      });

      // Sort by price and take the cheapest
      allListings.sort((a, b) => a.price - b.price);
      
      if (allListings.length > 0) {
        bestPrices.set(itemId, allListings.slice(0, item.quantity));
      }
    });

    return { items, bestPrices };
  }

  optimizeForTravel(items, results) {
    const bestPrices = new Map();
    const gilThreshold = parseInt(document.getElementById("gilThreshold").value);
    const priceThreshold = document.getElementById("priceThreshold").value / 100;
    const worldsVisited = new Set(); // Track worlds we're already visiting

    items.forEach((item, itemId) => {
      const allListings = [];

      // Gather all listings for this item
      results.forEach((data, datacenter) => {
        if (data.items[itemId]?.listings) {
          data.items[itemId].listings.forEach((listing) => {
            allListings.push({
              price: listing.pricePerUnit,
              world: listing.worldName,
              datacenter: datacenter,
            });
          });
        }
      });

      // Sort by price
      allListings.sort((a, b) => a.price - b.price);

      if (allListings.length === 0) {
        return;
      }

      const selectedListings = [];
      let remainingQuantity = item.quantity;
      const cheapestPrice = allListings[0].price;

      // Always take the absolute cheapest first
      selectedListings.push(allListings[0]);
      worldsVisited.add(allListings[0].world);
      remainingQuantity--;
      allListings.splice(0, 1);

      // For remaining quantity
      while (remainingQuantity > 0 && allListings.length > 0) {
        let bestListing = null;
        let bestIndex = -1;

        // For cheap items (< gilThreshold), strongly prefer worlds we're already visiting
        if (cheapestPrice < gilThreshold) {
          // First check if we can get it from a world we're already visiting
          for (let i = 0; i < allListings.length; i++) {
            if (worldsVisited.has(allListings[i].world)) {
              bestListing = allListings[i];
              bestIndex = i;
              break;
            }
          }
          
          // If not found in visited worlds, just take the cheapest
          if (!bestListing) {
            bestListing = allListings[0];
            bestIndex = 0;
          }
        } else {
          // For expensive items (>= gilThreshold), consider price threshold
          
          // First, check worlds we're already visiting
          let bestVisitedWorldListing = null;
          let bestVisitedWorldIndex = -1;
          let bestVisitedWorldPrice = Infinity;
          
          for (let i = 0; i < allListings.length; i++) {
            if (worldsVisited.has(allListings[i].world) && allListings[i].price < bestVisitedWorldPrice) {
              bestVisitedWorldListing = allListings[i];
              bestVisitedWorldIndex = i;
              bestVisitedWorldPrice = allListings[i].price;
            }
          }
          
          // Check if the cheapest overall is worth traveling for
          const cheapestOverall = allListings[0];
          
          if (bestVisitedWorldListing) {
            // We have an option in a world we're already visiting
            const priceDiff = (bestVisitedWorldPrice - cheapestOverall.price) / cheapestOverall.price;
            
            if (priceDiff <= priceThreshold) {
              // The price difference is small enough, stay in the visited world
              bestListing = bestVisitedWorldListing;
              bestIndex = bestVisitedWorldIndex;
            } else {
              // Price difference is too large, go to the cheaper world
              bestListing = cheapestOverall;
              bestIndex = 0;
            }
          } else {
            // No options in visited worlds, take the cheapest
            bestListing = cheapestOverall;
            bestIndex = 0;
          }
        }

        // Add the selected listing
        selectedListings.push(bestListing);
        worldsVisited.add(bestListing.world);
        remainingQuantity--;
        allListings.splice(bestIndex, 1);
      }

      if (selectedListings.length > 0) {
        bestPrices.set(itemId, selectedListings);
      }
    });

    return { items, bestPrices };
  }

  displayResults({ items, bestPrices, npcItems }) {
    const output = document.getElementById("output");
    output.innerHTML = "";

    // Create tabs
    const tabsContainer = document.createElement("div");
    tabsContainer.style.cssText = "margin: 20px 0; border-bottom: 1px solid #4a4a4a;";

    const marketTab = document.createElement("button");
    marketTab.textContent = "Market Items";
    marketTab.style.cssText = "padding: 10px 20px; margin-right: 10px; border: none; background: #2d7a31; color: white; cursor: pointer; border-radius: 4px 4px 0 0;";

    const npcTab = document.createElement("button");
    npcTab.textContent = "NPC Items";
    npcTab.style.cssText = "padding: 10px 20px; border: none; background: #3a3a3a; color: #b0b0b0; cursor: pointer; border-radius: 4px 4px 0 0;";

    tabsContainer.appendChild(marketTab);
    tabsContainer.appendChild(npcTab);
    output.appendChild(tabsContainer);

    // Create content containers
    const marketContent = document.createElement("div");
    const npcContent = document.createElement("div");
    npcContent.style.display = "none";

    // Market items content
    if (items.size === 0) {
      marketContent.innerHTML = "<p>No market board items found.</p>";
    } else {
      // Group by datacenter and world
      const datacenterGroups = new Map();

      bestPrices.forEach((listings, itemId) => {
        const item = items.get(itemId);
        listings.forEach((listing) => {
          if (!datacenterGroups.has(listing.datacenter)) {
            datacenterGroups.set(listing.datacenter, new Map());
          }
          if (!datacenterGroups.get(listing.datacenter).has(listing.world)) {
            datacenterGroups.get(listing.datacenter).set(listing.world, []);
          }
          datacenterGroups.get(listing.datacenter).get(listing.world).push({
            name: item.name,
            price: listing.price,
            quantity: 1,
          });
        });
      });

      // Create container for all datacenters
      const container = document.createElement("div");
      container.className = "datacenter-container";
      
      // Apply auto-animate to the container for smooth additions
      if (window.autoAnimate) {
        window.autoAnimate(container);
      }

      // Display results grouped by datacenter and world
      datacenterGroups.forEach((worlds, datacenter) => {
        const dcDiv = document.createElement("div");
        dcDiv.className = "datacenter-results";

        // Calculate total cost for this datacenter
        const datacenterTotalCost = Array.from(worlds.values())
          .flatMap((items) => items)
          .reduce((sum, item) => sum + item.price, 0);

        // Create header with collapse button and total
        const header = document.createElement("div");
        header.className = "datacenter-header";
        header.innerHTML = `
                <div class="header-content">
                    <span class="collapse-icon">▼</span>
                    <h2>Data Center: ${datacenter}</h2>
                    <span class="datacenter-total">${datacenterTotalCost.toLocaleString()} gil</span>
                </div>
            `;

        // Create content container
        const contentDiv = document.createElement("div");
        contentDiv.className = "datacenter-content";

        // Create world cards container
        const worldCardsContainer = document.createElement("div");
        worldCardsContainer.className = "world-cards-container";
        
        // Apply auto-animate for smooth card additions
        if (window.autoAnimate) {
          window.autoAnimate(worldCardsContainer);
        }

        worlds.forEach((items, world) => {
          const worldCard = document.createElement("div");
          worldCard.className = "world-card";

          // Group identical items
          const groupedItems = new Map();
          items.forEach((item) => {
            const key = `${item.name}-${item.price}`;
            if (!groupedItems.has(key)) {
              groupedItems.set(key, { ...item, quantity: 0 });
            }
            groupedItems.get(key).quantity++;
          });

          const totalCost = Array.from(groupedItems.values()).reduce((sum, item) => sum + item.price * item.quantity, 0);

          worldCard.innerHTML = `
                    <h3>${world}</h3>
                    <p class="world-total">Total Cost: ${totalCost.toLocaleString()} gil</p>
                    <div class="items-list">
                        ${Array.from(groupedItems.values())
                          .map((item) => `<div class="item-entry">${item.quantity}x ${item.name} (${item.price.toLocaleString()} gil each)</div>`)
                          .join("")}
                    </div>
                `;
          worldCardsContainer.appendChild(worldCard);
        });

        contentDiv.appendChild(worldCardsContainer);
        dcDiv.appendChild(header);
        dcDiv.appendChild(contentDiv);
        container.appendChild(dcDiv);

        // Add click handler for collapse/expand
        header.addEventListener("click", () => {
          contentDiv.style.display = contentDiv.style.display === "none" ? "block" : "none";
          header.querySelector(".collapse-icon").textContent = contentDiv.style.display === "none" ? "▶" : "▼";
        });
      });

      marketContent.appendChild(container);
    }

    // NPC items content
    if (npcItems.size === 0) {
      npcContent.innerHTML = "<p>No NPC vendor items found.</p>";
    } else {
      const npcList = document.createElement("div");
      let totalNpcCost = 0;

      // Group items by vendor and category
      const vendorGroups = new Map();
      npcItems.forEach((item) => {
        const npcInfo = this.isNpcItem(item.name);
        if (npcInfo) {
          if (!vendorGroups.has(npcInfo.vendor)) {
            vendorGroups.set(npcInfo.vendor, new Map()); // Map for categories
          }

          // Find the category for this item
          let category = "General";
          for (const [cat, items] of Object.entries(this.npcItems[npcInfo.vendor])) {
            if (items.items && items.items.find((i) => i.name === item.name)) {
              category = cat;
              break;
            }
          }

          if (!vendorGroups.get(npcInfo.vendor).has(category)) {
            vendorGroups.get(npcInfo.vendor).set(category, []);
          }

          vendorGroups
            .get(npcInfo.vendor)
            .get(category)
            .push({
              ...item,
              price: npcInfo.price,
              totalCost: npcInfo.price * item.quantity,
            });
          totalNpcCost += npcInfo.price * item.quantity;
        }
      });

      // Create vendor sections
      vendorGroups.forEach((categories, vendor) => {
        const vendorSection = document.createElement("div");
        vendorSection.className = "datacenter-results";

        const vendorTotal = Array.from(categories.values())
          .flat()
          .reduce((sum, item) => sum + item.totalCost, 0);

        // Vendor header with collapse button
        const header = document.createElement("div");
        header.className = "datacenter-header";
        header.innerHTML = `
                <div class="header-content">
                    <span class="collapse-icon">▼</span>
                    <h2>Vendor: ${vendor}</h2>
                    <span class="datacenter-total">${vendorTotal.toLocaleString()} gil</span>
                </div>
            `;

        // Create content container
        const contentDiv = document.createElement("div");
        contentDiv.className = "datacenter-content";

        // Create category cards container
        const categoryCardsContainer = document.createElement("div");
        categoryCardsContainer.className = "world-cards-container";

        // Create category cards (styled like world cards)
        categories.forEach((items, category) => {
          const categoryCard = document.createElement("div");
          categoryCard.className = "world-card";

          const categoryTotal = items.reduce((sum, item) => sum + item.totalCost, 0);

          categoryCard.innerHTML = `
                    <h3>${category}</h3>
                    <p class="world-total">Total Cost: ${categoryTotal.toLocaleString()} gil</p>
                    <div class="items-list">
                        ${items.map((item) => `<div class="item-entry">${item.quantity}x ${item.name} (${item.price.toLocaleString()} gil each)</div>`).join("")}
                    </div>
                `;
          categoryCardsContainer.appendChild(categoryCard);
        });

        contentDiv.appendChild(categoryCardsContainer);
        vendorSection.appendChild(header);
        vendorSection.appendChild(contentDiv);
        npcList.appendChild(vendorSection);

        // Add click handler for collapse/expand
        header.addEventListener("click", () => {
          contentDiv.style.display = contentDiv.style.display === "none" ? "block" : "none";
          header.querySelector(".collapse-icon").textContent = contentDiv.style.display === "none" ? "▶" : "▼";
        });
      });

      npcContent.appendChild(npcList);
    }

    output.appendChild(marketContent);
    output.appendChild(npcContent);

    // Tab switching logic
    marketTab.addEventListener("click", () => {
      marketTab.style.background = "#2d7a31";
      marketTab.style.color = "white";
      npcTab.style.background = "#3a3a3a";
      npcTab.style.color = "#b0b0b0";
      marketContent.style.display = "block";
      npcContent.style.display = "none";
    });

    npcTab.addEventListener("click", () => {
      npcTab.style.background = "#2d7a31";
      npcTab.style.color = "white";
      marketTab.style.background = "#3a3a3a";
      marketTab.style.color = "#b0b0b0";
      marketContent.style.display = "none";
      npcContent.style.display = "block";
    });
  }

  async loadNpcItems() {
    try {
      const response = await fetch("npc_items.json");
      this.npcItems = await response.json();
    } catch (error) {
      console.error("Error loading NPC items:", error);
      this.npcItems = {};
    }
  }

  async loadItemNames() {
    try {
      const response = await fetch("items.json");
      this.itemNames = await response.json();
    } catch (error) {
      console.error("Error loading item names:", error);
      this.itemNames = {};
    }
  }

  generateGCItemIds() {
    const itemIds = [];
    for (const range of this.gcItemRanges) {
      for (let i = range.start; i <= range.end; i++) {
        itemIds.push(i);
      }
    }
    return itemIds;
  }

  async processSealShopping() {
    const selectedDatacenters = Array.from(document.querySelectorAll('input[name="datacenter"]:checked')).map((cb) => cb.value);
    const priceThreshold = parseInt(document.getElementById("sealPriceThreshold").value);

    if (selectedDatacenters.length === 0) {
      alert("Please select at least one data center");
      return;
    }

    try {
      this.showLoading();
      const itemIds = this.generateGCItemIds();
      const results = await this.fetchSealShoppingPrices(itemIds, selectedDatacenters);
      const analyzedData = this.analyzeSealShoppingData(results, priceThreshold);
      this.displaySealShoppingResults(analyzedData, priceThreshold);
    } catch (error) {
      console.error("Error processing seal shopping:", error);
      alert("Error processing seal shopping. Please check console for details.");
    } finally {
      this.hideLoading();
    }
  }

  async fetchSealShoppingPrices(itemIds, datacenters) {
    const results = new Map();
    const BATCH_SIZE = 100; // API supports up to 100 items per request
    const MAX_CONCURRENT = 4; // Reduced concurrent connections for seal shopping
    const RATE_LIMIT = 25;
    const MIN_DELAY = 1000 / RATE_LIMIT;
    const LISTINGS_PER_ITEM = 10; // Fetch up to 10 listings per item to find all under threshold

    // Create batches of item IDs
    const itemBatches = [];
    for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
      itemBatches.push(itemIds.slice(i, i + BATCH_SIZE));
    }

    // Process each datacenter
    for (const dc of datacenters) {
      results.set(dc, new Map());
      
      // Process batches with rate limiting
      for (let i = 0; i < itemBatches.length; i++) {
        const batch = itemBatches[i];
        const itemIdsString = batch.join(",");
        const url = `https://universalis.app/api/v2/${dc}/${itemIdsString}?listings=${LISTINGS_PER_ITEM}&entries=0`;
        
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();
          
          // Store results for each item
          Object.entries(data.items).forEach(([itemId, itemData]) => {
            if (itemData.listings && itemData.listings.length > 0) {
              results.get(dc).set(itemId, itemData.listings);
            }
          });
        } catch (error) {
          console.error(`Error fetching batch for ${dc}:`, error);
        }
        
        // Rate limiting delay
        await new Promise((resolve) => setTimeout(resolve, MIN_DELAY));
      }
    }

    return results;
  }

  analyzeSealShoppingData(results, priceThreshold) {
    const worldData = new Map(); // world -> { datacenter, itemGroups: Map<itemName, {totalQuantity, maxPrice}> }
    
    // Process all datacenters and aggregate by world
    results.forEach((items, datacenter) => {
      items.forEach((listings, itemId) => {
        const itemName = this.itemNames[itemId]?.en || `Item ${itemId}`;
        
        listings.forEach((listing) => {
          if (listing.pricePerUnit <= priceThreshold) {
            const worldName = listing.worldName;
            
            if (!worldData.has(worldName)) {
              worldData.set(worldName, {
                datacenter: datacenter,
                itemGroups: new Map()
              });
            }
            
            const worldInfo = worldData.get(worldName);
            
            // Group by item name and track quantity and max price
            if (!worldInfo.itemGroups.has(itemName)) {
              worldInfo.itemGroups.set(itemName, {
                totalQuantity: 0,
                maxPrice: 0
              });
            }
            
            const itemGroup = worldInfo.itemGroups.get(itemName);
            itemGroup.totalQuantity += listing.quantity;
            itemGroup.maxPrice = Math.max(itemGroup.maxPrice, listing.pricePerUnit);
          }
        });
      });
    });
    
    // Convert to array and calculate scores
    const sortedWorlds = Array.from(worldData.entries())
      .map(([world, data]) => {
        // Convert item groups to array
        const items = Array.from(data.itemGroups.entries())
          .map(([name, info]) => ({ 
            name, 
            quantity: info.totalQuantity,
            maxPrice: info.maxPrice
          }))
          .sort((a, b) => {
            // Sort by quantity first (higher first), then by name
            if (a.quantity !== b.quantity) {
              return b.quantity - a.quantity;
            }
            return a.name.localeCompare(b.name);
          });
        
        // Calculate total quantity and unique item count
        const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
        const uniqueItemCount = items.length;
        
        return {
          world: world,
          datacenter: data.datacenter,
          uniqueItemCount: uniqueItemCount,
          totalQuantity: totalQuantity,
          items: items,
          // Score based on both variety and quantity
          score: uniqueItemCount * 1000 + totalQuantity
        };
      })
      .sort((a, b) => b.score - a.score);
    
    return sortedWorlds.slice(0, 5); // Return top 5 worlds
  }

  displaySealShoppingResults(analyzedData, priceThreshold) {
    const output = document.getElementById("output");
    output.innerHTML = "";

    if (analyzedData.length === 0) {
      output.innerHTML = `<div class="summary-section"><p>No items found under ${priceThreshold.toLocaleString()} gil.</p></div>`;
      return;
    }

    // Create summary section
    const summaryDiv = document.createElement("div");
    summaryDiv.className = "summary-section";
    summaryDiv.innerHTML = `
      <h2>Top Worlds for Grand Company Turn-ins Under ${priceThreshold.toLocaleString()} gil</h2>
      <p class="timestamp">Results generated at: ${new Date().toLocaleString()}</p>
    `;
    output.appendChild(summaryDiv);

    // Display each world's results
    analyzedData.forEach((worldData, index) => {
      const worldDiv = document.createElement("div");
      worldDiv.className = "datacenter-results";
      worldDiv.style.marginBottom = "20px";

      const headerDiv = document.createElement("div");
      headerDiv.className = "datacenter-header";
      headerDiv.innerHTML = `
        <div class="header-content">
          <span class="collapse-icon">▼</span>
          <h2>#${index + 1}: ${worldData.world} (${worldData.datacenter})</h2>
          <span class="datacenter-total">${worldData.uniqueItemCount} unique items (${worldData.totalQuantity} total) under ${priceThreshold.toLocaleString()} gil</span>
        </div>
      `;

      const contentDiv = document.createElement("div");
      contentDiv.className = "datacenter-content";
      
      const worldCard = document.createElement("div");
      worldCard.className = "world-card";
      worldCard.style.margin = "10px";
      
      const itemsList = document.createElement("div");
      itemsList.className = "items-list";
      
      // Apply auto-animate to items list for smooth item additions
      if (window.autoAnimate) {
        window.autoAnimate(itemsList);
      }
      
      // Add all items to the list
      worldData.items.forEach(item => {
        const itemEntry = document.createElement("div");
        itemEntry.className = "item-entry";
        itemEntry.textContent = `${item.quantity}× ${item.name} - under ${item.maxPrice.toLocaleString()} gil`;
        itemsList.appendChild(itemEntry);
      });
      
      worldCard.appendChild(itemsList);
      contentDiv.appendChild(worldCard);

      worldDiv.appendChild(headerDiv);
      worldDiv.appendChild(contentDiv);
      output.appendChild(worldDiv);

      // Add collapse functionality
      headerDiv.addEventListener("click", () => {
        contentDiv.style.display = contentDiv.style.display === "none" ? "block" : "none";
        headerDiv.querySelector(".collapse-icon").textContent = contentDiv.style.display === "none" ? "▶" : "▼";
      });
    });
  }
}

// Initialize the application
new MarketShopper();
