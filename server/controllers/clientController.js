// server/controllers/clientController.js
import { clients } from "../service/clients.js";

export const getClients = async (req, res) => {
  try {
    // Return all clients sorted alphabetically
    const sortedClients = clients.sort((a, b) => a.name.localeCompare(b.name));
    res.status(200).json(sortedClients);
  } catch (error) {
    console.error(" Error fetching clients:", error);
    res.status(500).json({ message: "Failed to load clients" });
  }
};
