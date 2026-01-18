const axios = require('axios');

/**
 * ගෲප් එකක ඇඩ්මින්ලා කවුද කියලා හොයාගන්නා ෆන්ක්ෂන් එක
 * @param {Array} participants 
 * @returns {Array} admins
 */
const getGroupAdmins = (participants) => {
    let admins = [];
    for (let i of participants) {
        if (i.admin === "admin" || i.admin === "superadmin") {
            admins.push(i.id);
        }
    }
    return admins;
};

/**
 * URL එකක් මගින් JSON දත්ත ලබා ගැනීම
 * @param {String} url 
 */
const getBuffer = async (url, options) => {
    try {
        options ? options : {};
        const res = await axios({
            method: "get",
            url,
            headers: {
                'DNT': 1,
                'Upgrade-Insecure-Request': 1
            },
            ...options,
            responseType: 'arraybuffer'
        });
        return res.data;
    } catch (e) {
        return e;
    }
};

/**
 * තත්පර ගණන පැය, මිනිත්තු සහ තත්පර වලට හැරවීම (Uptime එකට ප්‍රයෝජනවත් වේ)
 * @param {Number} seconds 
 */
const runtime = (seconds) => {
    seconds = Number(seconds);
    var d = Math.floor(seconds / (3600 * 24));
    var h = Math.floor(seconds % (3600 * 24) / 3600);
    var m = Math.floor(seconds % 3600 / 60);
    var s = Math.floor(seconds % 60);
    var dDisplay = d > 0 ? d + (d == 1 ? " day, " : " days, ") : "";
    var hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : "";
    var mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : "";
    var sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
    return dDisplay + hDisplay + mDisplay + sDisplay;
};

/**
 * ෆයිල් සයිස් එක කියවිය හැකි ලෙස හැරවීම (KB, MB, GB)
 */
const formatSize = (bytes) => {
    if (bytes >= 1000000000) { bytes = (bytes / 1000000000).toFixed(2) + ' GB'; }
    else if (bytes >= 1000000) { bytes = (bytes / 1000000).toFixed(2) + ' MB'; }
    else if (bytes >= 1000) { bytes = (bytes / 1000).toFixed(2) + ' KB'; }
    else if (bytes > 1) { bytes = bytes + ' bytes'; }
    else if (bytes == 1) { bytes = bytes + ' byte'; }
    else { bytes = '0 byte'; }
    return bytes;
};

/**
 * නිවැරදි JID එකක් ලබා ගැනීම
 */
const sleep = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

module.exports = { 
    getGroupAdmins, 
    getBuffer, 
    runtime, 
    formatSize, 
    sleep 
};
