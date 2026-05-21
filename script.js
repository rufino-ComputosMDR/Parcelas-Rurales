// Configuración Inicial del Mapa
const map = L.map('map').setView([-34.15, -62.6], 10);
let capaZonas, capaParcelas;
let datosRuralesGlobal = null; 

// Capa Base
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

const colores = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4'];

// 1. CARGAR ZONAS Y PRE-CARGAR PARCELAS AL INICIAR
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

fetch('rurales.geojson')
    .then(res => res.json())
    .then(data => { datosRuralesGlobal = data; })
    .catch(err => console.error("Error pre-cargando rurales.geojson:", err));


// 2. FUNCIÓN PARA CARGAR PARCELAS
function cargarParcelas(idHoja, bounds, idParcelaAIluminar = null) {
    if (capaParcelas) map.removeLayer(capaParcelas);
    
    if (!datosRuralesGlobal) {
        fetch('rurales.geojson')
            .then(res => res.json())
            .then(data => {
                datosRuralesGlobal = data;
                renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar);
            });
    } else {
        renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar);
    }
}

function renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar) {
    capaParcelas = L.geoJSON(datosRuralesGlobal, {
        filter: (feature) => feature.properties.Hoja == idHoja,
        style: (feature) => {
            if (idParcelaAIluminar && feature.properties.PARTIDA === idParcelaAIluminar) {
                return { color: '#000000', weight: 3, fillColor: '#ffff00', fillOpacity: 0.8 };
            }
            return { color: '#d35400', weight: 1, fillColor: '#e67e22', fillOpacity: 0.3 };
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
                let valor = p[key];
                // Validación exacta de tu propiedad de importe
                if (key === "Total Adeudado sin Judic. Al 16-06-26") {
                    valor = "$ " + valor;
                }
                tablaHtml += `<tr><td class="label">${key}</td><td>${valor}</td></tr>`;
            }
            
            tablaHtml += `</table></div>`;
            layer.bindPopup(tablaHtml, { autoPanPadding: L.point(10, 50) });

            if (idParcelaAIluminar && p.PARTIDA === idParcelaAIluminar) {
                setTimeout(() => {
                    if (layer._path) {
                        layer._path.classList.add('parcela-titilando');
                    }
                    layer.openPopup(); 
                }, 600);
            }
        }
    }).addTo(map);

    if (map.hasLayer(capaZonas)) map.removeLayer(capaZonas);
    map.fitBounds(bounds, { padding: [30, 30] });
    document.getElementById('btn-reset').style.display = 'block';
}

// 3. ASISTENTE DE COINCIDENCIAS (AUTOCOMPLETAR)
function actualizarCoincidencias() {
    const valor = document.getElementById('input-busqueda').value.trim().toLowerCase();
    const datalist = document.getElementById('coincidencias');
    datalist.innerHTML = ""; 

    if (valor.length < 2 || !datosRuralesGlobal) return;

    let contador = 0;
    for (let f of datosRuralesGlobal.features) {
        const p = f.properties;
        const partida = p["PARTIDA"] ? p["PARTIDA"].toString() : "";
        const tgi = p["TGIRural"] ? p["TGIRural"].toString() : "";
        const titular = p["Tit. Nombre"] ? p["Tit. Nombre"].toString() : "";

        if (partida.toLowerCase().includes(valor) || tgi.toLowerCase().includes(valor) || titular.toLowerCase().includes(valor)) {
            const option = document.createElement('option');
            option.value = `Partida: ${partida} | TGI: ${tgi} | ${titular}`;
            datalist.appendChild(option);
            
            contador++;
            if (contador >= 8) break; 
        }
    }
}

// 4. MOTOR DE BÚSQUEDA UNIFICADO
function ejecutarBusqueda() {
    let valorBuscado = document.getElementById('input-busqueda').value.trim();

    if (!valorBuscado) {
        alert("Por favor, ingrese un término para buscar.");
        return;
    }
    if (!datosRuralesGlobal) {
        alert("Los datos aún se están cargando en segundo plano.");
        return;
    }

    if (valorBuscado.includes("Partida: ")) {
        valorBuscado = valorBuscado.split("|")[0].replace("Partida: ", "").trim();
    } else {
        valorBuscado = valorBuscado.toLowerCase();
    }

    const parcelaEncontrada = datosRuralesGlobal.features.find(f => {
        const p = f.properties;
        const partida = p["PARTIDA"] ? p["PARTIDA"].toString().toLowerCase() : "";
        const tgi = p["TGIRural"] ? p["TGIRural"].toString().toLowerCase() : "";
        const titular = p["Tit. Nombre"] ? p["Tit. Nombre"].toString().toLowerCase() : "";

        return partida === valorBuscado || tgi.includes(valorBuscado) || titular.includes(valorBuscado);
    });

    if (parcelaEncontrada) {
        const idHoja = parcelaEncontrada.properties.Hoja;
        const partida = parcelaEncontrada.properties.PARTIDA;
        
        const capaTemporal = L.geoJSON(parcelaEncontrada);
        const boundsParcela = capaTemporal.getBounds();

        cargarParcelas(idHoja, boundsParcela, partida);
    } else {
        alert("No se encontró ninguna parcela que coincida.");
    }
}

// 5. FUNCIÓN PARA REGRESAR EN EL MAPA
function volverAlMapa() {
    if (capaParcelas) map.removeLayer(capaParcelas);
    if (!map.hasLayer(capaZonas)) capaZonas.addTo(map);
    map.fitBounds(capaZonas.getBounds());
    document.getElementById('btn-reset').style.display = 'none';
    document.getElementById('input-busqueda').value = ""; 
}


// ==========================================
// FUNCIONALIDAD: REPORTE TOP 50 DEUDORES
// ==========================================

function mostrarTopDeudores() {
    if (!datosRuralesGlobal) {
        alert("Los datos aún se están cargando. Aguarde un instante.");
        return;
    }

    const tablaCuerpo = document.getElementById('cuerpo-tabla-reporte');
    tablaCuerpo.innerHTML = ""; 

    // Extraemos las propiedades de todas las parcelas rurales
    let listaParcelas = datosRuralesGlobal.features.map(f => f.properties);

    // Ordenamos de Mayor a Menor de forma exacta usando tu campo "Periodos Deuda"
    listaParcelas.sort((a, b) => {
        let perA = parseInt(a["Periodos Deuda"]) || 0;
        let perB = parseInt(b["Periodos Deuda"]) || 0;
        return perB - perA; 
    });

    // Tomamos las primeras 50 parcelas
    const top50 = listaParcelas.slice(0, 50);

    // Renderizamos las filas con tus campos exactos
    top50.forEach((p, index) => {
        let tgi = p["TGIRural"] || "---";
        let nombre = p["Tit. Nombre"] || "SIN TITULAR";
        let periodos = p["Periodos Deuda"] || 0;
        let deudaValor = p["Total Adeudado sin Judic. Al 16-06-26"] || "0";

        const fila = document.createElement('tr');
        fila.innerHTML = `
            <td><strong>${index + 1}</strong></td>
            <td>${tgi}</td>
            <td>${nombre}</td>
            <td style="text-align: center; color: #c0392b; font-weight: bold;">${periodos}</td>
            <td style="font-weight: bold;">$ ${deudaValor}</td>
        `;
        tablaCuerpo.appendChild(fila);
    });

    // Cambiamos de pantalla: Ocultamos mapa, mostramos tabla formal
    document.getElementById('map').style.display = 'none';
    document.getElementById('contenedor-busqueda').style.display = 'none';
    document.getElementById('btn-reset').style.display = 'none';
    document.getElementById('btn-reporte').style.display = 'none';
    
    document.getElementById('pantalla-reporte').style.display = 'block';
}

function cerrarReporte() {
    document.getElementById('pantalla-reporte').style.display = 'none';
    
    document.getElementById('map').style.display = 'block';
    document.getElementById('contenedor-busqueda').style.display = 'flex';
    document.getElementById('btn-reporte').style.display = 'block';
    
    if (capaParcelas && map.hasLayer(capaParcelas)) {
        document.getElementById('btn-reset').style.display = 'block';
    }

    setTimeout(() => { map.invalidateSize(); }, 100);
}