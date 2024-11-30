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
    this.loadNpcItems();
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

    // Process all listings to find best prices with optimization
    const bestPrices = new Map();
    const threshold = document.getElementById("optimizeTravel").checked ? document.getElementById("priceThreshold").value / 100 : 0;

    items.forEach((item, itemId) => {
      const allListings = [];
      const listingsByWorld = new Map(); // world -> listings

      // Gather and organize all listings by world
      results.forEach((data, datacenter) => {
        if (data.items[itemId]?.listings) {
          data.items[itemId].listings.forEach((listing) => {
            const listingInfo = {
              price: listing.pricePerUnit,
              world: listing.worldName,
              datacenter: datacenter,
            };
            allListings.push(listingInfo);

            if (!listingsByWorld.has(listing.worldName)) {
              listingsByWorld.set(listing.worldName, []);
            }
            listingsByWorld.get(listing.worldName).push(listingInfo);
          });
        }
      });

      // Sort all listings by price
      allListings.sort((a, b) => a.price - b.price);

      if (allListings.length === 0) {
        return;
      }

      const neededQuantity = item.quantity;
      const selectedListings = [];
      const cheapestPrice = allListings[0].price;

      if (document.getElementById("optimizeTravel").checked) {
        // Optimization mode
        let remainingQuantity = neededQuantity;

        while (remainingQuantity > 0 && allListings.length > 0) {
          // Sort remaining listings by price again to ensure we always get the current cheapest
          allListings.sort((a, b) => a.price - b.price);

          // Get the current cheapest listing
          const cheapestListing = allListings[0];
          selectedListings.push(cheapestListing);
          remainingQuantity--;

          // Remove the used listing
          allListings.splice(0, 1);

          // If we still need more items, filter the remaining listings
          if (remainingQuantity > 0) {
            // Find all listings within threshold of the cheapest price
            const acceptableListings = allListings.filter((listing) => {
              // If the item's cheapest price is below gil threshold, stay in same world
              if (cheapestListing.price < parseInt(document.getElementById("gilThreshold").value)) {
                return listing.world === cheapestListing.world;
              }

              // For expensive items, check percentage threshold
              const priceIncrease = (listing.price - cheapestListing.price) / cheapestListing.price;
              const percentThreshold = document.getElementById("priceThreshold").value / 100;
              return priceIncrease <= percentThreshold;
            });

            if (acceptableListings.length > 0) {
              // Group acceptable listings by world
              const worldGroups = new Map();
              acceptableListings.forEach((listing) => {
                if (!worldGroups.has(listing.world)) {
                  worldGroups.set(listing.world, []);
                }
                worldGroups.get(listing.world).push(listing);
              });

              // Prefer the world with the most listings within threshold
              let bestWorld = null;
              let maxListings = 0;

              worldGroups.forEach((listings, world) => {
                if (listings.length > maxListings) {
                  maxListings = listings.length;
                  bestWorld = world;
                }
              });

              if (bestWorld) {
                const worldListings = worldGroups.get(bestWorld).sort((a, b) => a.price - b.price);
                const toAdd = Math.min(worldListings.length, remainingQuantity);
                selectedListings.push(...worldListings.slice(0, toAdd));
                remainingQuantity -= toAdd;

                // Remove used listings from allListings
                worldListings.slice(0, toAdd).forEach((usedListing) => {
                  const index = allListings.findIndex((l) => l.world === usedListing.world && l.price === usedListing.price);
                  if (index !== -1) allListings.splice(index, 1);
                });
              }
            }
            // If no acceptable listings found, the loop will continue
            // and find the next cheapest listing in any world
          }
        }
      } else {
        // No optimization - just take the cheapest prices regardless of world
        selectedListings.push(...allListings.slice(0, neededQuantity));
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
    tabsContainer.style.cssText = "margin: 20px 0; border-bottom: 1px solid #ddd;";

    const marketTab = document.createElement("button");
    marketTab.textContent = "Market Items";
    marketTab.style.cssText = "padding: 10px 20px; margin-right: 10px; border: none; background: #4caf50; color: white; cursor: pointer; border-radius: 4px 4px 0 0;";

    const npcTab = document.createElement("button");
    npcTab.textContent = "NPC Items";
    npcTab.style.cssText = "padding: 10px 20px; border: none; background: #ddd; color: black; cursor: pointer; border-radius: 4px 4px 0 0;";

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
      marketTab.style.background = "#4caf50";
      marketTab.style.color = "white";
      npcTab.style.background = "#ddd";
      npcTab.style.color = "black";
      marketContent.style.display = "block";
      npcContent.style.display = "none";
    });

    npcTab.addEventListener("click", () => {
      npcTab.style.background = "#4caf50";
      npcTab.style.color = "white";
      marketTab.style.background = "#ddd";
      marketTab.style.color = "black";
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
}

// Initialize the application
new MarketShopper();
