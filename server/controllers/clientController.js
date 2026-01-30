// server/controllers/clientController.js
const bmSecurityAPI = require("../service/bmSecurityAPI");

const getClients = async (req, res) => {
  try {
    console.log('📞 Fetching clients from BM Security API...');
    
    // Fetch clients from the BM Security API
    const clients = await bmSecurityAPI.getClients();
    
    // Check if we got valid data
    if (!clients || !Array.isArray(clients)) {
      console.warn('⚠️ API returned invalid client data');
      return res.status(500).json({ 
        success: false,
        message: "Invalid client data received from API",
        clients: [] 
      });
    }
    
    // Sort alphabetically by name
    const sortedClients = clients.sort((a, b) => 
      a.name.localeCompare(b.name)
    );
    
    console.log(`✅ Successfully fetched ${sortedClients.length} clients`);
    
    res.status(200).json({
      success: true,
      clients: sortedClients,
      count: sortedClients.length
    });
    
  } catch (error) {
    console.error("❌ Error fetching clients:", error);
    
    // Check if it's an authentication error
    if (error.message?.includes('authentication') || 
        error.message?.includes('login') || 
        error.message?.includes('credentials')) {
      return res.status(401).json({ 
        success: false,
        message: "API authentication failed. Please check credentials.",
        clients: []
      });
    }
    
    // Generic error response
    res.status(500).json({ 
      success: false,
      message: error.message || "Failed to load clients from API",
      clients: []
    });
  }
};

module.exports = {
  getClients
};