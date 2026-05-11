// Configuración Inicial del Mapa
const map = L.map('map').setView([-34.15, -62.6], 10);
let capaZonas, capaParcelas;

// Capa Base
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

const colores = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4'];

// 1. CARGAR ZONAS
fetch('zonas.geojson')
    .then(res => res.json())
    .then(data => {
        capaZonas = L.geoJSON(data, {
            style: (feature) => ({
                fillColor: colores[feature.properties.id % colores.length],
                weight: 2,
                color: 'white',
                fillOpacity: 0.5
            }),
            onEachFeature: (feature, layer) => {
                layer.bindTooltip("Hoja " + feature.properties.id, {
                    permanent: true,
                    direction: 'center',
                    className: 'etiqueta-zona'
                });

                layer.on('click', function(e) {
                    const idHoja = feature.properties.id;
                    cargarParcelas(idHoja, e.target.getBounds());
                });
            }
        }).addTo(map);
        
        map.fitBounds(capaZonas.getBounds());
    })
    .catch(err => console.error("Error cargando zonas.geojson:", err));

// 2. FUNCIÓN PARA CARGAR PARCELAS
function cargarParcelas(idHoja, bounds) {
    if (capaParcelas) map.removeLayer(capaParcelas);
    
    fetch('rurales.geojson')
        .then(res => res.json())
        .then(data => {
            capaParcelas = L.geoJSON(data, {
                filter: (feature) => feature.properties.Hoja == idHoja,
                style: {
                    color: '#d35400',
                    weight: 1,
                    fillColor: '#e67e22',
                    fillOpacity: 0.3
                },
                onEachFeature: (feature, layer) => {
                    const p = feature.properties;
                    if (p.TGIRural) {
                        layer.bindTooltip(p.TGIRural.toString(), {
                            permanent: true,
                            direction: 'center',
                            className: 'etiqueta-parcela'
                        });
                    }

                    let tablaHtml = `<div class="ficha-contenedor">
                        <h3 style="margin:0; color:#2c3e50;">Ficha Parcela</h3>
                        <table class="ficha-tabla">`;
                    for (let key in p) {
                        tablaHtml += `<tr><td class="label">${key}</td><td>${p[key]}</td></tr>`;
                    }
                    tablaHtml += `</table></div>`;
                    layer.bindPopup(tablaHtml);
                }
            }).addTo(map);

            map.removeLayer(capaZonas);
            map.fitBounds(bounds, { padding: [30, 30] });
            document.getElementById('btn-reset').style.display = 'block';
        })
        .catch(err => console.error("Error cargando rurales.geojson:", err));
}

// 3. FUNCIÓN PARA REGRESAR
function volverAlMapa() {
    if (capaParcelas) map.removeLayer(capaParcelas);
    capaZonas.addTo(map);
    map.fitBounds(capaZonas.getBounds());
    document.getElementById('btn-reset').style.display = 'none';
}