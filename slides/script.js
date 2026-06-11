// slidesData is loaded globally

const container = document.getElementById('slides-container');

function renderSlides() {
    let slidesHtml = '';

    slidesData.forEach((slide) => {
        let content = '';
        
        switch(slide.type) {
            case 'title':
                content = `
                    <section class="title-slide">
                        ${slide.logo ? `<img src="${slide.logo}" style="height: 100px; background:none; border:none; box-shadow:none; margin-bottom:30px;">` : ''}
                        <div class="subtitle">${slide.subtitle || ''}</div>
                        <h1>${slide.title}</h1>
                        <div class="authors">
                            ${slide.authors.map(a => `<p>${a}</p>`).join('')}
                        </div>
                        <p style="margin-top:20px; opacity:0.6; font-size:0.6em;">${slide.department || ''}</p>
                    </section>
                `;
                break;

            case 'section_header':
                content = `
                    <section>
                        <div class="glass-container">
                            <h2>${slide.title}</h2>
                            <hr style="width:100px; border-color:var(--accent);">
                            <p style="font-size:1.5em; margin-top:30px;">${slide.content}</p>
                        </div>
                    </section>
                `;
                break;

            case 'two_column':
            case 'technological_landscape':
                content = `
                    <section>
                        <h2>${slide.title}</h2>
                        <div class="two-col">
                            ${slide.columns.map(col => `
                                <div class="glass-container">
                                    <h3 style="color:var(--accent); font-size:1.2em;">${col.title}</h3>
                                    <p>${col.content}</p>
                                </div>
                            `).join('')}
                        </div>
                    </section>
                `;
                break;

            case 'grid_icons':
                content = `
                    <section>
                        <h2>${slide.title}</h2>
                        <div class="grid-icons">
                            ${slide.items.map(item => `
                                <div class="icon-card">
                                    <i class="fa-solid ${item.icon}"></i>
                                    <h4>${item.title}</h4>
                                    <p>${item.content}</p>
                                </div>
                            `).join('')}
                        </div>
                    </section>
                `;
                break;

            case 'two_column_image':
            case 'embedded_firmware_logic':
            case 'electrical_systems':
                content = `
                    <section>
                        <h2>${slide.title}</h2>
                        ${slide.subtitle ? `<p class="subtitle">${slide.subtitle}</p>` : ''}
                        <div class="two-col">
                            <div class="glass-container" style="text-align:left;">
                                ${slide.bullets ? `<ul>${slide.bullets.map(b => `<li>${b}</li>`).join('')}</ul>` : ''}
                            </div>
                            <div class="img-box">
                                <img src="${slide.image}">
                            </div>
                        </div>
                    </section>
                `;
                break;

            case 'feature_list':
                content = `
                    <section>
                        <h2>${slide.title}</h2>
                        <p>${slide.description}</p>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:30px;">
                            ${slide.features.map(f => `
                                <div class="feature-item">
                                    <div class="feature-num">${f.num}</div>
                                    <div>
                                        <h4 style="margin:0; font-size:1em; color:var(--accent);">${f.title}</h4>
                                        <p style="margin:0;">${f.text}</p>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </section>
                `;
                break;

            case 'bleed_image':
                content = `
                    <section>
                        <div class="two-col" style="height:100%;">
                            <div style="text-align:left;">
                                <h2>${slide.title}</h2>
                                <div class="glass-container">
                                    ${slide.content_blocks.map(b => `
                                        <h4 style="color:var(--accent); margin-bottom:10px;">${b.heading}</h4>
                                        <ul style="font-size:0.8em; margin-bottom:20px;">
                                            ${b.list.map(l => `<li>${l}</li>`).join('')}
                                        </ul>
                                    `).join('')}
                                </div>
                            </div>
                            <div style="height:600px; background:url('${slide.image}') no-repeat center center/cover; border-radius:16px;"></div>
                        </div>
                    </section>
                `;
                break;
                
            case 'image_gallery':
                content = `
                    <section>
                        <h2>${slide.title}</h2>
                        <div class="grid-icons" style="grid-template-columns: repeat(3, 1fr);">
                            ${slide.items.map(item => `
                                <div class="icon-card">
                                    <img src="${item.image}" style="height:150px; border-radius:8px;">
                                    <h4 style="font-size:1em; margin-top:10px;">${item.title}</h4>
                                    <p style="font-size:0.7em;">${item.text}</p>
                                </div>
                            `).join('')}
                        </div>
                    </section>
                `;
                break;

            default:
                content = `<section><h2>${slide.title}</h2><p>Content Type: ${slide.type}</p></section>`;
        }
        slidesHtml += content;
    });

    container.innerHTML = slidesHtml;
    
    // Initialize Reveal
    Reveal.initialize({
        hash: true,
        transition: 'convex', // none/fade/slide/convex/concave/zoom
        autoSlide: 0,
        controls: true,
        progress: true,
        center: true
    });
}

// Run
document.addEventListener('DOMContentLoaded', renderSlides);
