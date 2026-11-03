const fs = require('fs');
const path = require('path');
const { Builder } = require('selenium-webdriver');
const ie = require('selenium-webdriver/ie');

async function launchBrowser() {
    const edgePath = [process.env.UNLOAD_EDGE_EXE,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(value => value && fs.existsSync(value));
    if (!edgePath) throw new Error('Edge not found. Set UNLOAD_EDGE_EXE to msedge.exe.');
    const driverPath = process.env.UNLOAD_IE_DRIVER || path.join(__dirname, 'drivers', 'IEDriverServer.exe');
    if (!fs.existsSync(driverPath)) throw new Error('IEDriver missing. See unload-receipts/README.md.');
    const options = new ie.Options().setEdgeChromium(true).setEdgePath(edgePath);
    options.set('pageLoadStrategy', 'eager');
    const driver = await new Builder().forBrowser('ie').setIeOptions(options).setIeService(new ie.ServiceBuilder(driverPath)).build();
    await driver.manage().setTimeouts({ pageLoad: 60000, script: 15000, implicit: 0 });
    return driver;
}
module.exports = { launchBrowser };
