const rentData = {
  Toronto: {
    "Downtown": { "1br": 2100, "2br": 2800, "3br": 3550 },
    "Riverdale": { "1br": 1850, "2br": 2450, "3br": 3100 },
    "North York Centre": { "1br": 1950, "2br": 2550, "3br": 3250 }
  },
  Vancouver: {
    "Kitsilano": { "1br": 1750, "2br": 2450, "3br": 3150 },
    "Mount Pleasant": { "1br": 1880, "2br": 2650, "3br": 3350 },
    "Metrotown": { "1br": 1820, "2br": 2480, "3br": 3200 }
  },
  Montreal: {
    "Plateau-Mont-Royal": { "1br": 1350, "2br": 1820, "3br": 2250 },
    "Verdun": { "1br": 1220, "2br": 1650, "3br": 2100 },
    "Mile End": { "1br": 1400, "2br": 1900, "3br": 2350 }
  },
  Calgary: {
    "Beltline": { "1br": 1500, "2br": 1950, "3br": 2550 },
    "Kensington": { "1br": 1580, "2br": 2050, "3br": 2650 },
    "Bridgeland": { "1br": 1450, "2br": 1900, "3br": 2500 }
  },
  Edmonton: {
    "Old Strathcona": { "1br": 1380, "2br": 1820, "3br": 2350 },
    "Oliver": { "1br": 1320, "2br": 1750, "3br": 2280 },
    "Whyte Avenue": { "1br": 1360, "2br": 1800, "3br": 2320 }
  }
};

const citySelect = document.getElementById("city");
const neighbourhoodSelect = document.getElementById("neighbourhood");
const rentForm = document.getElementById("rent-form");
const results = document.getElementById("results");

function populateCities() {
  Object.keys(rentData).forEach((city) => {
    const option = document.createElement("option");
    option.value = city;
    option.textContent = city;
    citySelect.appendChild(option);
  });
}

function populateNeighbourhoods(city) {
  neighbourhoodSelect.innerHTML = "<option value=\"\">Select a neighbourhood</option>";
  if (!city) {
    return;
  }
  Object.keys(rentData[city]).forEach((neighbourhood) => {
    const option = document.createElement("option");
    option.value = neighbourhood;
    option.textContent = neighbourhood;
    neighbourhoodSelect.appendChild(option);
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0
  }).format(value);
}

function getComparisonLabel(diffPercent) {
  if (diffPercent > 5) {
    return { label: "Above average", className: "over" };
  }
  if (diffPercent < -5) {
    return { label: "Below average", className: "under" };
  }
  return { label: "Right around average", className: "equal" };
}

rentForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const city = citySelect.value;
  const neighbourhood = neighbourhoodSelect.value;
  const unit = document.getElementById("unit").value;
  const rentValue = Number(document.getElementById("rent").value);

  if (!city || !neighbourhood || !unit || !rentValue) {
    results.innerHTML = "<p>Please complete all fields to see your results.</p>";
    return;
  }

  const average = rentData[city][neighbourhood][unit];
  const diff = rentValue - average;
  const diffPercent = (diff / average) * 100;
  const { label, className } = getComparisonLabel(diffPercent);

  results.innerHTML = `
    <div class="result-card ${className}">
      <h3>${label}</h3>
      <p>Your rent: <strong>${formatCurrency(rentValue)}</strong></p>
      <p>CMHC neighbourhood average: <strong>${formatCurrency(average)}</strong></p>
      <p>You are ${Math.abs(diffPercent).toFixed(1)}% ${diff >= 0 ? "above" : "below"} the average.</p>
    </div>
    <div class="result-card">
      <h3>What this means</h3>
      <p>
        If you are above average, you may want to negotiate, look for nearby alternatives, or track upcoming
        CMHC releases for updated benchmarks.
      </p>
    </div>
  `;
});

citySelect.addEventListener("change", (event) => {
  populateNeighbourhoods(event.target.value);
});

populateCities();
