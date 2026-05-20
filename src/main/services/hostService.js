const os = require('os');
const http = require('http'); 
const { json } = require('stream/consumers'); 
 
const activeRooms = new Map();


// Get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
} 

function createHostService() { 
    function createRoomServer(roomId, hostInfo) {
        const port = hostInfo.title == "Left 4 Dead 2" ? 3000 : 3001;
        const localIP = getLocalIP();
        
        const server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            
            if (req.url === '/room' || req.url === `/room/${roomId}`) {
                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    room: {
                        id: roomId,
                        host: hostInfo,
                        url: `http://${localIP}:${port}/room`,
                        createdAt: new Date().toISOString()
                    }
                }));
                return;
            }
            
            if (req.url === '/health') {
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'alive', roomId }));
                return;
            }
            
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        });
        
        server.listen(port, '0.0.0.0', () => {
            console.log(`Room server running at http://${localIP}:${port}/room`);
        });
        
        return { server, port, localIP, url: `http://${localIP}:${port}/room` };
    }

    return {
      createRoom(data) {
        const roomId = `room-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        const hostInfo = {
          hostId: data.hostId,
          pcName: os.hostname(),
          localIP: getLocalIP(),
          playerName: data.playerName,
          gameId: data.gameId,
          map: data.map,
          mapname: data.mapname,
          streamType: "sunshine",
          sunshineHost: getLocalIP(),
          title: data.title,
          createdAt: new Date().toISOString(),
        }; 

        const { server, url } = createRoomServer(roomId, hostInfo); 

        activeRooms.set(roomId, {
          id: roomId,
          server,
          hostInfo,
          players: [],
        }); 

        return {
          success: true,
          room: {
            id: roomId,
            url,
            host: hostInfo, 
          },
        };
      },

      async getRooms() {
        return await this.getRoomFromLink();
      },

      async getRoomFromLink() {
        const localIP = getLocalIP();
        const subnet = localIP.split(".").slice(0, 3).join(".") + ".";

        const found = [];
        const ports = [3000, 3001, 3002];
        const promises = [];

        for (let i = 1; i < 255; i++) {
          const ip = subnet + i;

          for (const port of ports) {
            promises.push(
              fetch(`http://${ip}:${port}/room`, {
                signal: AbortSignal.timeout(3000),
              })
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => {
                  if (data?.room) {
                    found.push({
                      id: data.room.id,
                      host: data.room.host,
                      playerCount: 0,
                      url: data.room.url,
                      ip,
                      port,
                    });
                  }
                })
                .catch(() => null)
            );
          }
        }

        await Promise.all(promises);

        return found;
      },

      closeRoom(roomId) {
        const room = activeRooms.get(roomId);
        if (room) {
          room.server.close();
          activeRooms.delete(roomId);
          return { success: true };
        }
        return { success: false, error: "Room not found" };
      },
    };
}

module.exports = { createHostService };