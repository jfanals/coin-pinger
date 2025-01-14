// UI Elements
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const logBody = document.getElementById('logBody');
const statusIndicator = document.getElementById('status');

// Audio Context and Nodes
let audioContext;
let analyser;
let microphone;
let highPassFilter;
let dataArray;
let frequencyDataArray;
let animationId;

// Chart.js setup
const ctx = document.getElementById('frequencyChart').getContext('2d');
const chart = new Chart(ctx, {
    type: 'bar',
    data: {
        labels: [], // Frequencies
        datasets: [{
            label: 'Detected Frequencies',
            data: [],
            type: 'bar',
            backgroundColor: 'rgba(0, 255, 0, 1)', // Semi-transparent dark green
            borderColor: 'rgba(0, 255, 0, 1)', // Solid dark green border
            borderWidth: 2,
            barPercentage: 50,
            barThickness: 5,
        }, {
            label: 'Non-Matching Frequencies',
            data: [],
            type: 'bar',
            backgroundColor: 'rgba(255, 0, 0, 0.7)', // Semi-transparent red
            borderColor: 'rgba(255, 0, 0, 1)', // Solid red border
            borderWidth: 2,
            barPercentage: 50,
            barThickness: 5,
        }, {
            label: 'Amplitude',
            data: [], // Amplitudes
            backgroundColor: 'rgba(0, 123, 255, 0.5)',
            barPercentage: 50,
        }, {
            label: 'Detected Coin Range',
            data: [],
            type: 'bar',
            backgroundColor: 'rgba(0, 255, 0, 0.25)', // Semi-transparent light green
            borderColor: 'rgba(0, 255, 0, 0.25)', // Solid light green border
            barPercentage: 1,
        }]
    },
    options: {
        responsive: true,
        scales: {
            x: {
                type: 'linear',
                title: {
                    display: true,
                    text: 'Frequency (Hz)'
                },
                min: 4000, // Start at 4kHz to eliminate low-frequency noise
                max: 20000, // Upper limit for better visibility
                ticks: {
                    stepSize: 1000
                },
                stacked: true
            },
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Amplitude'
                },
                stacked: false
            }
        },
        plugins: {
            legend: {
                display: true,
                position: 'top',
            }
        },
        animation: {
            duration: 0 // Disable animations for instant updates
        }
    }
});

// Event Listeners
startButton.addEventListener('click', startAnalysis);
stopButton.addEventListener('click', stopAnalysis);

// Load settings from local storage
function loadSettings() {
    const xScale = localStorage.getItem('xScale') || 'linear';
    const pingTimeout = localStorage.getItem('pingTimeout') || 10;

    document.getElementById('xScale').value = xScale;
    document.getElementById('pingTimeout').value = pingTimeout;

    return { xScale, pingTimeout };
}

// Save settings to local storage
function saveSettings() {
    const xScale = document.getElementById('xScale').value;
    const pingTimeout = document.getElementById('pingTimeout').value;

    localStorage.setItem('xScale', xScale);
    localStorage.setItem('pingTimeout', pingTimeout);
}

// Reset settings to default values
function resetSettings() {
    localStorage.setItem('xScale', 'linear');
    localStorage.setItem('pingTimeout', 200);

    document.getElementById('xScale').value = 'linear';
    document.getElementById('pingTimeout').value = 200;

    updateChartOptions('linear');
    alert('Settings reset to default values!');
}

// Update chart options based on settings
function updateChartOptions(xScale) {
    chart.options.scales.x.type = xScale;
    chart.update();
}

// Event listeners for settings inputs
document.getElementById('xScale').addEventListener('change', () => {
    saveSettings();
    updateChartOptions(document.getElementById('xScale').value);
});

document.getElementById('pingTimeout').addEventListener('input', saveSettings);

// Event listener for reset settings button
document.getElementById('resetSettingsButton').addEventListener('click', resetSettings);

// Load settings and apply them
const { xScale, pingTimeout } = loadSettings();
updateChartOptions(xScale);

// Start Analysis Function
function startAnalysis() {
    startButton.disabled = true;
    stopButton.disabled = false;
    statusIndicator.textContent = 'Status: Initializing...';
    statusIndicator.style.color = 'orange';

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 16384; // Increased for better frequency resolution

    // Create a high-pass filter to cut off frequencies below 4kHz
    highPassFilter = audioContext.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 4000; // 4kHz cutoff

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            microphone = audioContext.createMediaStreamSource(stream);
            microphone.connect(highPassFilter);
            highPassFilter.connect(analyser);
            dataArray = new Uint8Array(analyser.fftSize);
            frequencyDataArray = new Uint8Array(analyser.frequencyBinCount);
            initializeChartLabels();
            statusIndicator.textContent = 'Status: Listening...';
            statusIndicator.style.color = 'green';
            detectPing(pingTimeout);
        })
        .catch(err => {
            console.error('Error accessing microphone', err);
            alert('Microphone access denied or not available.');
            statusIndicator.textContent = 'Status: Error';
            statusIndicator.style.color = 'red';
            startButton.disabled = false;
            stopButton.disabled = true;
        });
}

// Stop Analysis Function
function stopAnalysis() {
    startButton.disabled = false;
    stopButton.disabled = true;
    statusIndicator.textContent = 'Status: Idle';
    statusIndicator.style.color = 'green';

    if (animationId) {
        cancelAnimationFrame(animationId);
    }
    if (microphone) {
        microphone.disconnect();
    }
    if (highPassFilter) {
        highPassFilter.disconnect();
    }
    if (audioContext) {
        audioContext.close();
    }
    chart.data.datasets[0].data = []; // Clear detected frequencies
    chart.update('none');
}

// Initialize Chart Labels
function initializeChartLabels() {
    const nyquist = audioContext.sampleRate / 2;
    const frequencyStep = nyquist / analyser.frequencyBinCount;
    const labels = [];
    for (let i = 0; i < analyser.frequencyBinCount; i++) {
        const freq = i * frequencyStep;
        if (freq >= 4000 && freq <= 20000) { // Focus on 4kHz to 20kHz
            labels.push(freq.toFixed(0));
        }
    }
    chart.data.labels = labels;
}

// New variable to store the highest detected amplitude during cooldown
let coolingPing = 0;

// Ping Detection and Analysis
function detectPing(pingTimeout) {
    analyser.getByteFrequencyData(frequencyDataArray);
    let pingDetected = false;
    let maxAmplitude = 0;

    // Check if any frequency has an amplitude above 100 and find the max amplitude
    for (let i = 0; i < frequencyDataArray.length; i++) {
        if (frequencyDataArray[i] > 100) {
            pingDetected = true;
            if (frequencyDataArray[i] > maxAmplitude) {
                maxAmplitude = frequencyDataArray[i];
            }
        }
    }

    // Update coolingPing with the highest detected amplitude
    if (pingDetected && (maxAmplitude - 100) > coolingPing) {
        coolingPing = maxAmplitude;
        statusIndicator.textContent = 'Status: Ping Detected - Processing...';
        statusIndicator.style.color = 'orange';
        processPing(pingTimeout);
    }

    // Decay the coolingPing value over time
    coolingPing = Math.max(0, coolingPing - 1); // Adjust the decay rate as needed

    // Update the chart
    updateChart();

    animationId = requestAnimationFrame(() => detectPing(pingTimeout));
}

// Function to process the detected ping
function processPing(pingTimeout) {
    // Brief cooldown to collect the entire sound event
    setTimeout(() => {
        analyser.getByteFrequencyData(frequencyDataArray);

        // Extract frequencies
        const frequencies = getFrequencies(frequencyDataArray);

        // Identify Coin
        const { name: guessedCoin, matchingFrequencies, confidence } = identifyCoin(frequencies);

        // Update Log
        console.log('updating log');
        updateLog(frequencies, guessedCoin, confidence);

        // Highlight detected frequencies on the chart
        highlightFrequencies(frequencies, matchingFrequencies, guessedCoin);

        // Reset flags
        pingDetected = false;
        statusIndicator.textContent = 'Status: Listening...';
        statusIndicator.style.color = 'green';

    }, pingTimeout); // Use the user-defined timeout
}

// Function to get significant frequencies using peak detection
function getFrequencies(frequencyData) {
    const nyquist = audioContext.sampleRate / 2;
    const frequencyStep = nyquist / frequencyData.length;
    let peaks = [];

    // Find peaks above a certain amplitude threshold
    const amplitudeThreshold = 5; // Adjust as needed
    for (let i = 1; i < frequencyData.length - 1; i++) {
        if (frequencyData[i] > amplitudeThreshold &&
            frequencyData[i] > frequencyData[i - 1] &&
            frequencyData[i] > frequencyData[i + 1]) {
            const frequency = i * frequencyStep;
            peaks.push({ frequency, amplitude: frequencyData[i] });
        }
    }

    // Sort peaks by amplitude descending
    peaks.sort((a, b) => b.amplitude - a.amplitude);

    // Remove nearby peaks (within 50 Hz) to avoid duplicates
    const filteredPeaks = [];
    const minSeparation = 50; // Hz
    peaks.forEach(peak => {
        if (!filteredPeaks.some(p => Math.abs(p.frequency - peak.frequency) < minSeparation)) {
            filteredPeaks.push(peak);
        }
    });

    // Return top 5 frequencies
    return filteredPeaks.slice(0, 5);
}

// Function to identify the coin based on frequencies
function identifyCoin(frequencies) {
    let bestMatch = { name: "Unknown Coin", matchingFrequencies: [], confidence: 0 };

    for (let coin of knownCoins) {
        let matchCount = 0;
        let matchingFrequencies = [];
        let totalFrequencies = coin.frequencies.length;

        // Iterate through the coin's frequencies
        for (let freqObj of coin.frequencies) {
            const tolerance = freqObj.value * (freqObj.tolerancePercent / 100);
            const adjustedMin = freqObj.value - tolerance;
            const adjustedMax = freqObj.value + tolerance;

            // Check if any of the detected frequencies fall within the tolerance range for this frequency
            const isInRange = frequencies.some(freq => {
                const inRange = freq.frequency >= adjustedMin && freq.frequency <= adjustedMax;
                if (inRange) {
                    matchingFrequencies.push(freq);
                }
                return inRange;
            });

            if (isInRange) {
                matchCount++;
            }
        }

        // Calculate confidence as the ratio of matched frequencies to total frequencies
        const confidence = (matchCount / totalFrequencies) * 100;

        // If this coin has a higher confidence than the current best match, update the best match
        if (confidence > bestMatch.confidence) {
            bestMatch = { name: coin.name, matchingFrequencies, confidence };
        }
    }

    return bestMatch;
}

// Function to update the detection log
function updateLog(frequencies, guessedCoin, confidence) {
    const time = new Date().toLocaleTimeString();
    const freqString = frequencies.map(f => `${f.frequency.toFixed(0)} Hz (Amp: ${f.amplitude})`).join(', ');

    const newRow = document.createElement('tr');
    newRow.innerHTML = `
        <td>${time}</td>
        <td>${freqString}</td>
        <td>${guessedCoin}</td>
        <td>${confidence.toFixed(2)}%</td>
    `;

    logBody.prepend(newRow);

    // Keep only the last 10 entries
    while (logBody.rows.length > 10) {
        logBody.deleteRow(-1);
    }
}

// Function to update the Chart.js graph
function updateChart() {
    analyser.getByteFrequencyData(frequencyDataArray);

    // Focus on frequencies between 4kHz and 20kHz
    const nyquist = audioContext.sampleRate / 2;
    const frequencyStep = nyquist / analyser.frequencyBinCount;
    const filteredData = [];
    const filteredLabels = [];
    for (let i = 0; i < analyser.frequencyBinCount; i++) {
        const freq = i * frequencyStep;
        if (freq >= 4000 && freq <= 20000) { // Focus on 4kHz to 20kHz
            filteredData.push(frequencyDataArray[i]);
            filteredLabels.push(freq.toFixed(0));
        }
    }

    chart.data.labels = filteredLabels;
    chart.data.datasets[2].data = filteredData;
    chart.update('none');
}

// Function to highlight detected frequencies on the chart
function highlightFrequencies(frequencies, matchingFrequencies, guessedCoin) {
    
    // Prepare data for the detected frequencies bars
    const detectedFreqData = new Array(chart.data.labels.length).fill(null);
    const nonMatchingFreqData = new Array(chart.data.labels.length).fill(null);
    const coinRangeData = new Array(chart.data.labels.length).fill(null);
    
    frequencies.forEach(freq => {
        if (freq.frequency >= 4000 && freq.frequency <= 20000) {
            // Find the closest label index
            const index = chart.data.labels.findIndex(label => parseFloat(label) >= freq.frequency);
            if (index !== -1) {
                if (matchingFrequencies.some(mf => mf.frequency === freq.frequency)) {
                    detectedFreqData[index] = freq.amplitude;
                } else {
                    nonMatchingFreqData[index] = freq.amplitude;
                }
            }
        }
    });

    // Highlight the detected coin's frequencies
    const detectedCoin = knownCoins.find(coin => coin.name === guessedCoin);
    if (detectedCoin) {
        detectedCoin.frequencies.forEach(freqObj => {
            const tolerance = freqObj.value * (freqObj.tolerancePercent / 100);
            const adjustedMin = freqObj.value - tolerance;
            const adjustedMax = freqObj.value + tolerance;
            chart.data.labels.forEach((label, index) => {
                const freq = parseFloat(label);
                if (freq >= adjustedMin && freq <= adjustedMax) {
                    coinRangeData[index] = Math.max(...frequencyDataArray); // Set to max amplitude
                }
            });
        });
    }

    // Update the chart data
    chart.data.datasets[0].data = detectedFreqData;
    chart.data.datasets[1].data = nonMatchingFreqData;
    chart.data.datasets[3].data = coinRangeData;

    // Update the chart without animation
    chart.update('none');
}

// Default known coins
const defaultKnownCoins = [
    { 
        name: "Sovereign", 
        frequencies: [
            { value: 5600, tolerancePercent: 5 },
            { value: 12700, tolerancePercent: 5 }
        ]
    },
    { 
        name: "Krugerrand", 
        frequencies: [
            { value: 4900, tolerancePercent: 5 },
            { value: 10915, tolerancePercent: 5 },
            { value: 18500, tolerancePercent: 5 }
        ]
    }
];

// Load coin database from local storage
function loadCoinDatabase() {
    const storedCoins = localStorage.getItem('knownCoins');
    if (storedCoins) {
        return JSON.parse(storedCoins);
    } else {
        // Pre-populate with default known coins if local storage is empty
        saveCoinDatabase(defaultKnownCoins);
        return defaultKnownCoins;
    }
}

// Save coin database to local storage
function saveCoinDatabase(coins) {
    localStorage.setItem('knownCoins', JSON.stringify(coins));
}

// Initialize coin database
let knownCoins = loadCoinDatabase();

// Update coin list in the UI
function updateCoinList() {
    const coinList = document.getElementById('coinList');
    coinList.innerHTML = '';
    knownCoins.forEach((coin, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = coin.name;
        coinList.appendChild(option);
    });
}

// Add a new coin
function addCoin() {
    const coinName = document.getElementById('coinName').value.trim();
    if (coinName) {
        knownCoins.push({ name: coinName, frequencies: [] });
        saveCoinDatabase(knownCoins);
        updateCoinList();
        document.getElementById('coinName').value = '';
    }
}

// Delete a selected coin
function deleteCoin() {
    const coinList = document.getElementById('coinList');
    const selectedIndex = coinList.selectedIndex;
    if (selectedIndex !== -1) {
        knownCoins.splice(selectedIndex, 1);
        saveCoinDatabase(knownCoins);
        updateCoinList();
        document.getElementById('frequencyList').innerHTML = '';
    }
}

// Add a frequency to the selected coin
function addFrequency() {
    const coinList = document.getElementById('coinList');
    const selectedIndex = coinList.selectedIndex;
    if (selectedIndex !== -1) {
        const frequencyValue = parseFloat(document.getElementById('frequencyValue').value);
        const tolerancePercent = parseFloat(document.getElementById('tolerancePercent').value);
        if (!isNaN(frequencyValue) && !isNaN(tolerancePercent)) {
            knownCoins[selectedIndex].frequencies.push({ value: frequencyValue, tolerancePercent });
            saveCoinDatabase(knownCoins);
            updateFrequencyList(selectedIndex);
            document.getElementById('frequencyValue').value = '';
            document.getElementById('tolerancePercent').value = '';
        }
    }
}

// Update frequency list for the selected coin
function updateFrequencyList(index) {
    const frequencyList = document.getElementById('frequencyList');
    frequencyList.innerHTML = '';
    knownCoins[index].frequencies.forEach((freq, freqIndex) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${freq.value}</td>
            <td>${freq.tolerancePercent}</td>
            <td><button onclick="deleteFrequency(${index}, ${freqIndex})">Delete</button></td>
        `;
        frequencyList.appendChild(row);
    });
}

// Delete a frequency from the selected coin
function deleteFrequency(coinIndex, freqIndex) {
    knownCoins[coinIndex].frequencies.splice(freqIndex, 1);
    saveCoinDatabase(knownCoins);
    updateFrequencyList(coinIndex);
}

// Event listeners for coin management
document.getElementById('addCoinButton').addEventListener('click', addCoin);
document.getElementById('deleteCoinButton').addEventListener('click', deleteCoin);
document.getElementById('addFrequencyButton').addEventListener('click', addFrequency);
document.getElementById('coinList').addEventListener('change', (e) => {
    updateFrequencyList(e.target.selectedIndex);
});

// Initialize coin list on page load
updateCoinList();

document.addEventListener("DOMContentLoaded", function() {
    const canvas = document.getElementById('myCanvas');
    const context = canvas.getContext('2d');

    function resizeCanvas() {
        const aspectRatio = window.innerWidth / window.innerHeight;
        if (aspectRatio > 1) {
            // Landscape mode
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        } else {
            // Portrait mode
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
});