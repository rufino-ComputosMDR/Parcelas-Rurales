const map = L.map('map').setView([-34.15, -62.6], 10);
let capaZonas, capaParcelas, capaReferencias, marcadorCoordenada;
let datosRuralesGlobal = null; 
let datosReferenciasGlobal = null; 
let referenciasVisibles = false;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

const colores = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4'];

// 1. CARGA DE ARCHIVOS GEOJSON AL INICIAR
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
                    cargarParcelas(feature.properties.id, e.target.getBounds());
                });
            }
        }).addTo(map);
        map.fitBounds(capaZonas.getBounds());
        
        prepararCapaReferencias();
    })
    .catch(err => console.error("Error zonas:", err));

fetch('rurales.geojson')
    .then(res => res.json())
    .then(data => { datosRuralesGlobal = data; })
    .catch(err => console.error("Error rurales:", err));


// 2. REFERENCIAS (Estructura interna, inicia apagado)
function prepararCapaReferencias() {
    fetch('referencias.geojson')
        .then(res => res.json())
        .then(data => {
            datosReferenciasGlobal = data; 

            capaReferencias = L.geoJSON(data, {
                pointToLayer: function (feature, latlng) {
                    let p = feature.properties;
                    let nombreVisible = p.Name || "Punto sin nombre";

                    let textoIcono = L.divIcon({
                        className: 'texto-referencia-mapa',
                        html: `<div>📍 ${nombreVisible}</div>`,
                        iconSize: null 
                    });
                    
                    return L.marker(latlng, { icon: textoIcono });
                }
            }); 
        })
        .catch(err => console.error("Error referencias:", err));
}

// Control manual por botón flotante para encender/apagar referencias
function toggleReferencias() {
    if (!capaReferencias) return;
    
    if (referenciasVisibles) {
        map.removeLayer(capaReferencias);
        document.getElementById('btn-referencias').innerText = "📍 Mostrar Referencias";
        document.getElementById('btn-referencias').classList.remove('activo');
    } else {
        capaReferencias.addTo(map);
        document.getElementById('btn-referencias').innerText = "📍 Ocultar Referencias";
        document.getElementById('btn-referencias').classList.add('activo');
    }
    referenciasVisibles = !referenciasVisibles;
}

// 3. CAPA INTERACTIVA DE PARCELAS CATASTRALES
function cargarParcelas(idHoja, bounds, idParcelaAIluminar = null) {
    if (capaParcelas) map.removeLayer(capaParcelas);
    renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar);
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
                layer.bindTooltip(p.TGIRural.toString(), { permanent: true, direction: 'center', className: 'etiqueta-parcela' });
            }
            let tablaHtml = `<div class="ficha-contenedor"><h3 style="margin:0; color:#2c3e50;">Ficha Parcela</h3><table class="ficha-tabla">`;
            for (let key in p) {
                let valor = p[key];
                if (key.includes("Total Adeudado")) valor = "$ " + valor;
                tablaHtml += `<tr><td class="label">${key}</td><td>${valor}</td></tr>`;
            }
            tablaHtml += `</table></div>`;
            layer.bindPopup(tablaHtml, { autoPanPadding: L.point(10, 50) });

            if (idParcelaAIluminar && p.PARTIDA === idParcelaAIluminar) {
                setTimeout(() => {
                    if (layer._path) layer._path.classList.add('parcela-titilando');
                    layer.openPopup(); 
                }, 600);
            }
        }
    }).addTo(map);

    if (map.hasLayer(capaZonas)) map.removeLayer(capaZonas);
    
    map.fitBounds(bounds, { padding: [30, 30] });
    document.getElementById('btn-reset').style.display = 'block';
}

// 4. AUTOCOMPLETADO
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
            contador++; if (contador >= 8) break; 
        }
    }
}

// 5. MOTOR DE BÚSQUEDA CATASTRAL
function ejecutarBusqueda() {
    let valorBuscado = document.getElementById('input-busqueda').value.trim();
    if (!valorBuscado) { alert("Ingrese un término."); return; }
    if (valorBuscado.includes("Partida: ")) valorBuscado = valorBuscado.split("|")[0].replace("Partida: ", "").trim();
    else valorBuscado = valorBuscado.toLowerCase();

    const parcelaEncontrada = datosRuralesGlobal.features.find(f => {
        const p = f.properties;
        return (p["PARTIDA"] && p["PARTIDA"].toString().toLowerCase() === valorBuscado) || 
               (p["TGIRural"] && p["TGIRural"].toString().toLowerCase().includes(valorBuscado)) || 
               (p["Tit. Nombre"] && p["Tit. Nombre"].toString().toLowerCase().includes(valorBuscado));
    });
    if (parcelaEncontrada) hacerFocoEnParcela(parcelaEncontrada);
    else alert("No se encontró ninguna parcela.");
}

function hacerFocoEnParcela(parcela) {
    const idHoja = parcela.properties.Hoja;
    const partida = parcela.properties.PARTIDA;
    const capaTemporal = L.geoJSON(parcela);
    cargarParcelas(idHoja, capaTemporal.getBounds(), partida);
}

// 6. REPORTE 1: RANKING DE DEUDORES ECONOMICO
function mostrarTopDeudores() {
    if (!datosRuralesGlobal) { alert("Cargando datos..."); return; }
    
    document.getElementById('titulo-dinamico-reporte').innerText = "Ranking - Top 50 Mayores Deudas Rurales";
    document.getElementById('subtitulo-dinamico-impresion').innerText = "REPORTE GENERAL DE MOROSIDAD DE MAYOR CUANTÍA";
    document.getElementById('descripcion-dinamica-impresion').innerText = "Listado de los 50 contribuyentes con los montos adeudados más altos del distrito rural.";

    const cabecera = document.getElementById('cabecera-tabla-reporte');
    cabecera.innerHTML = `<tr>
        <th>#</th>
        <th>TGI Rural (Ir al mapa)</th>
        <th>Titular</th>
        <th>Períodos Debidos</th>
        <th>Total Adeudado</th>
    </tr>`;

    const tableBody = document.getElementById('cuerpo-tabla-reporte');
    tableBody.innerHTML = ""; 
    
    let listaParcelas = datosRuralesGlobal.features.map(f => f.properties);
    
    listaParcelas.sort((a, b) => {
        let deudaAString = a["Total Adeudado sin Judic. Al 16-06-26"] || "0";
        let deudaBString = b["Total Adeudado sin Judic. Al 16-06-26"] || "0";
        let valorA = parseFloat(deudaAString.replace(/[^0-9.-]+/g,"")) || 0;
        let valorB = parseFloat(deudaBString.replace(/[^0-9.-]+/g,"")) || 0;
        return valorB - valorA;
    });

    listaParcelas.slice(0, 50).forEach((p, index) => {
        let tgi = p["TGIRural"] || "---";
        let nombre = p["Tit. Nombre"] || "SIN TITULAR";
        let periodos = p["Periodos Deuda"] || 0;
        let deudaValor = p["Total Adeudado sin Judic. Al 16-06-26"] || "0";
        const fila = document.createElement('tr');
        fila.innerHTML = `<td><strong>${index + 1}</strong></td><td><a href="#" class="link-tgi-mapa" onclick="irAParcelaDesdeReporte('${tgi}')">🎯 ${tgi}</a></td><td>${nombre}</td><td style="text-align: center; color: #7f8c8d; font-weight: bold;">${periodos}</td><td style="font-weight: bold; color: #c0392b;">$ ${deudaValor}</td>`;
        tableBody.appendChild(fila);
    });

    abrirPantallaReporte();
}

// 7. REPORTE 2: ÍNDICE DE COSECHA ESTADÍSTICO 2026
function mostrarReporteCosecha() {
    document.getElementById('titulo-dinamico-reporte').innerText = "Estadísticas de Cosecha - Campaña 2026";
    document.getElementById('subtitulo-dinamico-impresion').innerText = "ÍNDICE PRODUCTIVO ESTIMADO POR HOJA CATASTRAL";
    document.getElementById('descripcion-dinamica-impresion').innerText = "Rendimientos promedio regionales proyectados para la campaña corriente.";

    const cabecera = document.getElementById('cabecera-tabla-reporte');
    cabecera.innerHTML = `<tr>
        <th>Hoja Catastral</th>
        <th>Uso Predominante del Suelo</th>
        <th>Rinde Promedio Soja (qq/Ha)</th>
        <th>Rinde Promedio Maíz (qq/Ha)</th>
        <th>Estado de Humedad</th>
    </tr>`;

    const tableBody = document.getElementById('cuerpo-tabla-reporte');
    tableBody.innerHTML = "";

    // Datos simulados en base a proyecciones reales de zona núcleo para las 6 Hojas
    const datosCosecha = [
        { hoja: "Hoja 1", cultivo: "Soja de Primera", soja: "42 - 45", maiz: "95 - 110", estado: "Óptimo" },
        { hoja: "Hoja 2", cultivo: "Maíz Temprano", soja: "38 - 42", maiz: "115 - 130", estado: "Muy Bueno" },
        { hoja: "Hoja 3", cultivo: "Mixto Ganadero/Agrícola", soja: "30 - 35", maiz: "85 - 95", estado: "Normal" },
        { hoja: "Hoja 4", cultivo: "Soja de Segunda / Trigo", soja: "26 - 32", maiz: "90 - 100", estado: "Regular" },
        { hoja: "Hoja 5", cultivo: "Maíz Tardío", soja: "35 - 40", maiz: "120 - 135", estado: "Excelente" },
        { hoja: "Hoja 6", cultivo: "Soja de Primera", soja: "40 - 44", maiz: "100 - 115", estado: "Muy Bueno" }
    ];

    datosCosecha.forEach(d => {
        const fila = document.createElement('tr');
        fila.innerHTML = `
            <td><strong>${d.hoja}</strong></td>
            <td>${d.cultivo}</td>
            <td style="color:#27ae60; font-weight:bold;">${d.soja} qq/Ha</td>
            <td style="color:#2980b9; font-weight:bold;">${d.maiz} qq/Ha</td>
            <td style="font-style:italic;">${d.estado}</td>
        `;
        tableBody.appendChild(fila);
    });

    abrirPantallaReporte();
}

// GESTIÓN DE PANTALLAS
function abrirPantallaReporte() {
    document.getElementById('map').style.display = 'none';
    document.getElementById('panel-busqueda-lateral').style.display = 'none';
    document.getElementById('contenedor-logo-mapa').style.display = 'none';
    document.querySelector('.botones-controles-derechos').style.display = 'none';
    document.getElementById('pantalla-reporte').style.display = 'block';
}

function irAParcelaDesdeReporte(tgiBuscado) {
    const parcela = datosRuralesGlobal.features.find(f => f.properties.TGIRural && f.properties.TGIRural.toString() === tgiBuscado.toString());
    if (parcela) { cerrarReporte(); hacerFocoEnParcela(parcela); }
    else { alert("No se localizó en mapa."); }
}

function cerrarReporte() {
    document.getElementById('pantalla-reporte').style.display = 'none';
    document.getElementById('map').style.display = 'block';
    document.getElementById('panel-busqueda-lateral').style.display = 'block';
    document.getElementById('contenedor-logo-mapa').style.display = 'block';
    document.querySelector('.botones-controles-derechos').style.display = 'flex';
    if (capaParcelas && map.hasLayer(capaParcelas)) document.getElementById('btn-reset').style.display = 'block';
    setTimeout(() => { map.invalidateSize(); }, 100);
}

function volverAlMapa() {
    if (capaParcelas) map.removeLayer(capaParcelas);
    if (marcadorCoordenada) map.removeLayer(marcadorCoordenada);
    if (!map.hasLayer(capaZonas)) capaZonas.addTo(map);
    map.fitBounds(capaZonas.getBounds());
    document.getElementById('btn-reset').style.display = 'none';
    document.getElementById('input-busqueda').value = ""; 
    document.getElementById('input-coordenadas').value = "";
}

function parsearDMSToDecimal(strInput) {
    if (!isNaN(parseFloat(strInput)) && !strInput.includes('°') && !strInput.includes("'")) return parseFloat(strInput);
    let partes = strInput.split(/[^\d\w\.]+/);
    let grados = parseFloat(partes[0]) || 0;
    let minutos = parseFloat(partes[1]) || 0;
    let segundos = parseFloat(partes[2]) || 0;
    let orientacion = strInput.toUpperCase();
    let res = grados + (minutos / 60) + (segundos / 3600);
    if (orientacion.includes('S') || orientacion.includes('W') || orientacion.includes('O')) res = res * -1;
    return res;
}

function buscarPorCoordenadas() {
    const rawValue = document.getElementById('input-coordenadas').value.trim();
    if (!rawValue) return;
    let partes = rawValue.split(','); if (partes.length !== 2) return;
    let lat = parsearDMSToDecimal(partes[0].trim());
    let lng = parsearDMSToDecimal(partes[1].trim());
    if (marcadorCoordenada) map.removeLayer(marcadorCoordenada);
    marcadorCoordenada = L.marker([lat, lng]).addTo(map).bindPopup(`Lat: ${lat}<br>Lng: ${lng}`).openPopup();
    map.setView([lat, lng], 14);
    document.getElementById('btn-reset').style.display = 'block';
}