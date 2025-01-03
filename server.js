import dotenv from 'dotenv';  // Import the dotenv package
dotenv.config();  // Load environment variables from .env file


import express from 'express';
import cors from 'cors';
import { RestClient } from '@ecoflow-api/rest-client';

// Set up the Express server
const app = express();
const port = 5000;

// Enable CORS for all origins
app.use(cors());

// Set up the EcoFlow API client
const client = new RestClient({
    accessKey: process.env.NEXT_PUBLIC_ACCESS_KEY, // Publicly accessible access key
    secretKey: process.env.SECRET_KEY, // Secure secret key
    host: "https://api-e.ecoflow.com"
});

// An array to store device data
let deviceDataList = [];

// Function to fetch device data
async function controlSmartPlug() {
    try {
        const plainDevices = await client.getDevicesPlain();
        console.log("Devices:", plainDevices);

        const smartPlug = await client.getDevice("HW52ZKH4SF5T1769");
        console.log("Smart Plug:", smartPlug);
        
        const properties = await smartPlug.getProperties();
        
        const data = {
            updateTime: new Date(properties['2_1.updateTime']).toISOString(),  // Convert to ISO 8601 format
            switchStatus: properties['2_1.switchSta'],
            country: properties['2_1.country'],
            town: properties['2_1.town'],
            volt: properties['2_1.volt'],
            current: properties['2_1.current'],
            watts: properties['2_1.watts'] / 10  // scaling down the value
        };

        // Calculate watt-hours (Wh)
        const wattHours = data.watts * (10 / 3600);  // Watts * (10 seconds / 3600 seconds)
        data.wattHours = wattHours;

        console.log("Device Data:", data);

        // Turn on the smart plug
        await smartPlug.switchOn();
        console.log("Smart plug turned on successfully.");

        // Push the new data into the list
        deviceDataList.push(data);
    } catch (error) {
        console.error("Error:", error);
    }
}

// Helper function to convert UTC time to Nairobi time (UTC +3)
function toNairobiTime(date) {
    const localDate = new Date(date);
    localDate.setHours(localDate.getHours()-8); // Nairobi is UTC +3
    return localDate;
}

// Helper function to aggregate the data by period (10 seconds, minute, hourly, daily, weekly, monthly, yearly)
function aggregateData(periodType) {
    const aggregatedData = {};

    deviceDataList.forEach(data => {
        const date = toNairobiTime(new Date(data.updateTime)); // Convert to Nairobi time
        let periodKey;

        // Set the key based on the requested period type and format to ISO 8601
        if (periodType === 'hour') {
            // For Hourly, use ISO 8601 format: "YYYY-MM-DDTHH:00:00.000Z"
            periodKey = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours())).toISOString();
        } else if (periodType === 'day') {
            // For Daily, use ISO 8601 format: "YYYY-MM-DDT00:00:00.000Z"
            periodKey = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
        } else if (periodType === 'week') {
            // For Weekly, use ISO 8601 format with the date of the first day of the week
            const startOfWeek = new Date(date.setDate(date.getDate() - date.getDay())); // Start of the week (Sunday)
            periodKey = new Date(Date.UTC(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate())).toISOString();
        } else if (periodType === 'month') {
            // For Monthly, use ISO 8601 format: "YYYY-MM-01T00:00:00.000Z"
            periodKey = new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1)).toISOString();
        } else if (periodType === 'year') {
            // For Yearly, use ISO 8601 format: "YYYY-01-01T00:00:00.000Z"
            periodKey = new Date(Date.UTC(date.getFullYear(), 0, 1)).toISOString();
        } else if (periodType === 'minute') {
            // For Minute, use ISO 8601 format: "YYYY-MM-DDTHH:MM:00.000Z"
            periodKey = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes())).toISOString();
        } else if (periodType === '10seconds') {
            // For 10-second intervals, use ISO 8601 format: "YYYY-MM-DDTHH:MM:SS.000Z"
            periodKey = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), Math.floor(date.getSeconds() / 10) * 10)).toISOString();
        }

        // Initialize period data if not already initialized
        if (!aggregatedData[periodKey]) {
            aggregatedData[periodKey] = {
                totalWattHours: 0,
                totalVolt: 0,
                totalWattCount: 0,
                totalCurrent: 0,
                count: 0,
                maxWatts: -Infinity, // Initialize to a very low value
                minWatts: Infinity   // Initialize to a very high value
            };
        }

        // Aggregate the values
        aggregatedData[periodKey].totalWattHours += data.wattHours;  // Sum watt-hours
        aggregatedData[periodKey].totalVolt += data.volt;
        aggregatedData[periodKey].totalCurrent += data.current;
        aggregatedData[periodKey].totalWattCount += data.watts; // For average watts calculation
        aggregatedData[periodKey].maxWatts = Math.max(aggregatedData[periodKey].maxWatts, data.watts);
        aggregatedData[periodKey].minWatts = Math.min(aggregatedData[periodKey].minWatts, data.watts);
        aggregatedData[periodKey].count += 1;
    });

    // Compute the averages and return the aggregated data
    return Object.keys(aggregatedData).map((period, index) => {
        const { totalWattHours, totalVolt, totalCurrent, totalWattCount, count, maxWatts, minWatts } = aggregatedData[period];
        return {
            index: index + 1,  // Adding index for readability
            period,  // This will be in ISO 8601 format
            totalWattHours,  // Total watt-hours for the period (not averaged)
            averageVolt: totalVolt / count,  // Average voltage for the period
            averageCurrent: totalCurrent / count,  // Average current for the period
            averageWatts: totalWattCount / count,  // Average watts for the period
            maxWatts,  // Maximum watts for the period
            minWatts,   // Minimum watts for the period
            totalCount: count  // Total number of data points for this period
        };
    });
}

// Set up an interval to fetch the data every 10 seconds
setInterval(controlSmartPlug, 10000);

// Define endpoints for each data set
app.get('/smart-plug/10seconds', (req, res) => {
    if (deviceDataList.length > 0) {
        res.status(200).json(aggregateData('10seconds'));
    } else {
        res.status(500).json({ error: "No device data available" });
    }
});

app.get('/smart-plug/minute', (req, res) => {
    if (deviceDataList.length > 0) {
        res.status(200).json(aggregateData('minute'));
    } else {
        res.status(500).json({ error: "No device data available" });
    }
});

app.get('/smart-plug/hourly', (req, res) => {
    if (deviceDataList.length > 0) {
        res.status(200).json(aggregateData('hour'));
    } else {
        res.status(500).json({ error: "No device data available" });
    }
});

app.get('/smart-plug/daily', (req, res) => {
    if (deviceDataList.length > 0) {
        res.status(200).json(aggregateData('day'));
    } else {
        res.status(500).json({ error: "No device data available" });
    }
});

app.get('/smart-plug/weekly', (req, res) => {
    if (deviceDataList.length > 0) {
        res.status(200).json(aggregateData('week'));
    } else {
        res.status(500).json({ error: "No device data available" });
    }
});

app.get('/smart-plug/monthly', (req, res) => {
    if (deviceDataList.length > 0) {
        res.status(200).json(aggregateData('month'));
    } else {
        res.status(500).json({ error: "No device data available" });
    }
});

app.get('/smart-plug/annual', (req, res) => {
    if (deviceDataList.length > 0) {
        res.status(200).json(aggregateData('year'));
    } else {
        res.status(500).json({ error: "No device data available" });
    }
});

// Start the Express server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
