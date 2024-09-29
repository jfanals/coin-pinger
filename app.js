// Coin Database
const knownCoins = [
    { 
        name: "Sovereign", 
        frequencyRanges: [
            { min: 5450, max: 5650 },
            { min: 12200, max: 12800 }
        ],
        tolerancePercent: 3
    },
    { 
        name: "Krugerrand", 
        frequencyRanges: [
            { min: 4800, max: 5000 },
            { min: 10500, max: 11000 },
            { min: 18500, max: 19000 },
        ],
        tolerancePercent: 3
    },
    // Add more coins here as needed
];

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
            backgroundColor: 'rgba(255, 0, 0, 0.7)', // Semi-transparent red
            borderColor: 'rgba(255, 0, 0, 1)', // Solid red border
            borderWidth: 2,
            barPercentage: 50,
            // categoryPercentage: 1,
        }, {
            label: 'Amplitude',
            data: [], // Amplitudes
            backgroundColor: 'rgba(0, 123, 255, 0.5)',
            barPercentage: 50,
            // categoryPercentage: 0.8
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
                stacked: true
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
            detectPing();
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
    chart.update();
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

// Ping Detection and Analysis
let pingDetected = false;
let cooldown = false;

function detectPing() {
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += Math.abs(dataArray[i] - 128);
    }
    let average = sum / dataArray.length;

    // Simple threshold for detecting a ping
    if (average > 0.7 && !pingDetected && !cooldown) {
        chart.data.datasets[0].data = [];
        console.log('Ping detected');
        pingDetected = true;
        statusIndicator.textContent = 'Status: Ping Detected - Processing...';
        statusIndicator.style.color = 'orange';
        processPing();
    }

    // Update the chart
    updateChart();

    animationId = requestAnimationFrame(detectPing);
}

function processPing() {
    console.log('Processing ping...');
    // Brief cooldown to collect the entire sound event
    setTimeout(() => {
        analyser.getByteFrequencyData(frequencyDataArray);

        // Extract frequencies
        const frequencies = getFrequencies(frequencyDataArray);

        console.log('Detected Frequencies:', frequencies);

        // Identify Coin
        const guessedCoin = identifyCoin(frequencies);

        // Update Log
        updateLog(frequencies, guessedCoin);

        // Highlight detected frequencies on the chart
        highlightFrequencies(frequencies);

        // Reset flags
        pingDetected = false;
        cooldown = true;
        statusIndicator.textContent = 'Status: Listening...';
        statusIndicator.style.color = 'green';

        // Cooldown period
        setTimeout(() => {
            cooldown = false;
        }, 2000); // 1 second cooldown

    }, 750); // Wait 0.5 seconds to collect the sound
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
    for (let coin of knownCoins) {
        let matchCount = 0;

        // Iterate through the coin's frequency ranges
        for (let range of coin.frequencyRanges) {
            const tolerance = (range.max - range.min) * (coin.tolerancePercent / 100);
            const adjustedMin = range.min - tolerance;
            const adjustedMax = range.max + tolerance;

            // Check if any of the detected frequencies fall within the tolerance range for this range
            const isInRange = frequencies.some(freq => freq.frequency >= adjustedMin && freq.frequency <= adjustedMax);

            if (isInRange) {
                matchCount++;
            }
        }

        // If all ranges for the coin are matched, it's a valid coin
        if (matchCount === coin.frequencyRanges.length) {
            return coin.name;
        }
    }

    // If no coin matches, return "Unknown Coin"
    return "Unknown Coin";
}

// Function to update the detection log
function updateLog(frequencies, guessedCoin) {
    const time = new Date().toLocaleTimeString();
    const freqString = frequencies.map(f => `${f.frequency.toFixed(0)} Hz (Amp: ${f.amplitude})`).join(', ');

    const newRow = document.createElement('tr');
    newRow.innerHTML = `
        <td>${time}</td>
        <td>${freqString}</td>
        <td>${guessedCoin}</td>
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
    chart.data.datasets[1].data = filteredData;
    chart.update();
}

// Function to highlight detected frequencies on the chart
function highlightFrequencies(frequencies) {
    console.log('Highlighting frequencies:', frequencies);
    
    // Prepare data for the detected frequencies bars
    const detectedFreqData = new Array(chart.data.labels.length).fill(null);
    
    frequencies.forEach(freq => {
        if (freq.frequency >= 4000 && freq.frequency <= 20000) {
            // Find the closest label index
            const index = chart.data.labels.findIndex(label => parseFloat(label) >= freq.frequency);
            if (index !== -1) {
                detectedFreqData[index] = freq.amplitude;
            }
        }
    });

    // Update the chart data
    console.log('Detected Frequencies Data:', detectedFreqData);
    chart.data.datasets[0].data = detectedFreqData;

    // Update the chart without animation
    chart.update('none');
}