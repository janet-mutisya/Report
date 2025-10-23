import { clients } from '../service/clients.js';

export const getClients = (req, res) => {
  try {
    res.status(200).json({
      success: true,
      clients,
    });
  } catch (error) {
    console.error('❌ Error fetching clients:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load clients',
      error: error.message,
    });
  }
};
