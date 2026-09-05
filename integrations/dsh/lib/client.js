window.__ModuleLoader__.load({
  id: '@prismflow/dsh/ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const API_PREFIX = '/api/prismflow'

    const css = `
      .pf-shell{height:100%;min-height:0;overflow:hidden;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}.pf-shell-top{flex:none;padding:26px 28px 20px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);z-index:2}.pf-shell-content{flex:1;min-height:0;overflow:auto;padding:20px 28px 60px;overscroll-behavior:contain}
      .pf-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}.pf-title{margin:0;font-size:26px;line-height:1.2}.pf-sub{margin:7px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.pf-version{margin:5px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px}
      .pf-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0}.pf-tab,.pf-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 13px;font:inherit;font-size:13px;cursor:pointer}.pf-tab:hover,.pf-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}.pf-tab-on,.pf-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:white}.pf-btn:disabled{opacity:.5;cursor:not-allowed}.pf-danger{color:var(--dsw-alias-label-error)}
      .pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.pf-overview-page{width:min(100%,1180px);margin-inline:auto}.pf-overview-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:24px;padding:26px 28px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 34%,var(--dsw-alias-border-l2));border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-2)),var(--dsw-alias-bg-layer-2) 58%,color-mix(in srgb,#159957 7%,var(--dsw-alias-bg-layer-2)));box-shadow:0 14px 38px rgba(0,0,0,.08)}.pf-overview-hero:after{content:"";position:absolute;right:-70px;top:-90px;width:230px;height:230px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);pointer-events:none}.pf-overview-eyebrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}.pf-overview-hero h2{margin:0;font-size:25px;line-height:1.25}.pf-overview-hero p{max-width:760px;margin:9px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.65}.pf-overview-hero-actions{position:relative;z-index:1;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pf-overview-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}.pf-overview-metric{padding:16px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.pf-overview-metric span,.pf-overview-metric small{display:block}.pf-overview-metric span{color:var(--dsw-alias-label-secondary);font-size:11px}.pf-overview-metric strong{display:block;margin:5px 0 3px;font-size:26px;line-height:1.1}.pf-overview-metric small{color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-overview-section{margin-top:24px}.pf-overview-section-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:11px}.pf-overview-section-head h3{margin:0;font-size:16px}.pf-overview-section-head p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}.pf-overview-flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.pf-overview-flow-card{display:flex;min-height:168px;flex-direction:column;padding:17px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.pf-overview-flow-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.pf-overview-step{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:750}.pf-overview-flow-card h4{margin:12px 0 0;font-size:14px}.pf-overview-flow-card p{flex:1;margin:6px 0 13px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}.pf-overview-flow-card .pf-btn{align-self:flex-start}.pf-overview-bottom{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:12px;margin-top:16px}.pf-overview-health,.pf-overview-guardrails{padding:18px 20px}.pf-overview-health-list{display:flex;gap:7px;flex-wrap:wrap;margin-top:13px}.pf-overview-health-item{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);font-size:11px}.pf-overview-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.pf-overview-dot-on{background:#159957;box-shadow:0 0 0 3px rgba(21,153,87,.12)}.pf-overview-guardrails ul{margin:10px 0 0;padding-left:19px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.65}.pf-toolset-page{width:min(100%,1180px);margin-inline:auto}.pf-toolset-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:20px;margin-bottom:18px}.pf-toolset-header-copy{max-width:720px}.pf-toolset-header-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pf-skill-section .pf-toolset-header-actions{flex:none}.pf-toolset-stack{display:flex;flex-direction:column;gap:16px}.pf-toolset-section{padding:0;overflow:hidden}.pf-toolset-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:17px 20px;border-bottom:1px solid var(--dsw-alias-border-l2)}.pf-toolset-section-title{min-width:0}.pf-toolset-section-title h3{margin:0;font-size:15px}.pf-toolset-section-title p{margin:5px 0 0}.pf-toolset-section-head>.pf-badge{flex:none;white-space:nowrap}.pf-toolset-section-body{padding:18px 20px}.pf-toolset-section-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:13px 20px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3)}.pf-image-settings-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));align-items:start;gap:14px 16px}.pf-image-settings-grid>.pf-field{min-width:0;margin:0;grid-column:span 6}.pf-image-settings-grid>.pf-image-endpoint{grid-column:span 8}.pf-image-settings-grid>.pf-image-protocol{grid-column:span 4}.pf-image-settings-grid>.pf-image-number,.pf-image-settings-grid>.pf-image-compact{grid-column:span 2}.pf-image-settings-grid .pf-input,.pf-image-settings-grid .pf-select{width:100%}.pf-image-credentials{margin:0;border:0;border-top:1px solid var(--dsw-alias-border-l2);border-radius:0;padding:18px 20px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,var(--dsw-alias-bg-layer-2))}.pf-image-credential-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:16px;margin-bottom:14px}.pf-image-credential-copy strong{display:block;font-size:13px}.pf-image-credential-copy span{display:block;max-width:720px;margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}.pf-image-credential-state{text-align:right;white-space:nowrap}.pf-image-credential-state .pf-badge{margin-bottom:5px}.pf-image-credential-state span:last-child{display:block;font-size:11px}.pf-image-credential-row{display:grid;grid-template-columns:minmax(260px,1fr) auto;align-items:end;gap:12px}.pf-image-credential-row>.pf-field{min-width:0}.pf-image-credential-row .pf-input{width:100%}.pf-image-credential-actions{display:flex;gap:8px;align-items:center}.pf-toolset-mode{max-width:360px;margin:0 0 18px}.pf-toolset-mode .pf-select{width:100%}.pf-toolset-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.pf-plugin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.pf-plugin-card{display:flex;min-width:0;flex-direction:column;padding:15px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s ease,box-shadow .16s ease}.pf-plugin-card-enabled{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,var(--dsw-alias-border-l2));box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dsw-alias-brand-primary) 70%,transparent)}.pf-plugin-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.pf-plugin-card-head strong{display:block;font-size:14px}.pf-plugin-id{display:block;margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:10px;overflow-wrap:anywhere}.pf-plugin-description{flex:1;margin:10px 0!important;font-size:12px!important}.pf-plugin-summary{display:flex;gap:6px 12px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:10px}.pf-plugin-toggle{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2);font-size:12px;font-weight:650}.pf-plugin-tools{margin-top:11px}.pf-plugin-tools summary{cursor:pointer;color:var(--dsw-alias-brand-primary);font-size:11px}.pf-plugin-management{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding-top:11px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-error) 24%,var(--dsw-alias-border-l2))}.pf-plugin-management span{color:var(--dsw-alias-label-tertiary);font-size:10px}.pf-plugin-management .pf-btn{flex:none}.pf-plugin-tool-list{display:grid;gap:6px;margin-top:9px}.pf-tool-option{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:8px;min-width:0;min-height:34px;box-sizing:border-box;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:11px;cursor:pointer}.pf-tool-option:hover{border-color:var(--dsw-alias-brand-primary)}.pf-tool-option input{margin:2px 0 0}.pf-tool-option .pf-code{min-width:0;line-height:1.45;overflow-wrap:anywhere}.pf-origin-badge{white-space:nowrap;line-height:1.35}.pf-origin-system{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-2))}.pf-origin-custom{color:#a66300;background:rgba(210,135,0,.13)}.pf-skill-card{display:flex;min-width:0;min-height:154px;flex-direction:column;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}.pf-skill-card-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:10px}.pf-skill-card-head strong{min-width:0;line-height:1.45;overflow-wrap:anywhere;font-size:13px}.pf-skill-card-badges{display:grid;justify-items:end;gap:5px}.pf-skill-card-description{flex:1;margin:9px 0 13px!important}.pf-skill-card-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l2)}.pf-skill-card-actions .pf-check{padding:0}.pf-skill-card-actions .pf-btn{flex:none}.pf-skill-editor{margin:0}.pf-skill-editor .pf-preview{max-height:320px;white-space:pre-wrap}.pf-skill-save-actions{padding-top:4px}.pf-skill-danger{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:22px;padding:15px 16px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-error) 38%,var(--dsw-alias-border-l2));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-error) 6%,var(--dsw-alias-bg-layer-2))}.pf-skill-danger-copy{min-width:0}.pf-skill-danger-copy strong,.pf-skill-danger-copy span{display:block}.pf-skill-danger-copy strong{color:var(--dsw-alias-label-error);font-size:13px}.pf-skill-danger-copy span{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}.pf-skill-danger .pf-btn{flex:none}.pf-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;padding:16px;min-width:0}.pf-card h3{margin:0 0 8px;font-size:15px}.pf-card p{margin:5px 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}.pf-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.pf-space{justify-content:space-between}.pf-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}
      .pf-badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 9px;font-size:11px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}.pf-ok{color:#159957;background:rgba(21,153,87,.12)}.pf-off{color:var(--dsw-alias-label-tertiary)}
      .pf-review-page{width:min(100%,1240px);margin-inline:auto}.pf-review-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:16px}.pf-review-header .pf-section-help{max-width:760px;margin-bottom:0}.pf-review-filter-panel{margin-bottom:16px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.pf-review-filter-form{display:grid;grid-template-columns:minmax(260px,1fr) 180px 110px auto;align-items:end;gap:10px}.pf-review-filter-form .pf-field{min-width:0}.pf-review-filter-actions{display:flex;gap:8px}.pf-review-status-chips{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}.pf-review-status-chip{display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}.pf-review-status-chip strong{min-width:18px;text-align:center;color:var(--dsw-alias-label-primary)}.pf-review-status-chip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,var(--dsw-alias-bg-layer-3))}.pf-review-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:11px}.pf-review-toolbar .pf-actions{margin:0}.pf-review-list{display:flex;flex-direction:column;gap:10px}.pf-review-pagination{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.pf-review-pagination .pf-actions{margin:0}.pf-draft-card{padding:0;overflow:hidden;border-left:4px solid var(--dsw-alias-border-l2);transition:border-color .16s ease,box-shadow .16s ease}.pf-draft-card:hover{box-shadow:0 8px 24px rgba(0,0,0,.08)}.pf-draft-card.pf-draft-status-draft{border-left-color:#d58b08}.pf-draft-card.pf-draft-status-rejected{border-left-color:var(--dsw-alias-label-error)}.pf-draft-card.pf-draft-status-approved{border-left-color:#3478d4}.pf-draft-card.pf-draft-status-publishing{border-left-color:#8b5cf6}.pf-draft-card.pf-draft-status-published{border-left-color:#159957}.pf-draft-card-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:13px 16px 8px}.pf-draft-heading{min-width:0}.pf-draft-state-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:7px}.pf-draft-status{font-weight:650}.pf-draft-status-draft-badge{color:#9a6200;background:rgba(213,139,8,.14)}.pf-draft-status-rejected-badge{color:var(--dsw-alias-label-error);background:rgba(220,50,47,.1)}.pf-draft-status-approved-badge{color:#3478d4;background:rgba(52,120,212,.13)}.pf-draft-status-publishing-badge{color:#7c3aed;background:rgba(139,92,246,.13)}.pf-draft-status-published-badge{color:#159957;background:rgba(21,153,87,.12)}.pf-draft-dirty{color:var(--dsw-alias-label-error);background:rgba(220,50,47,.1)}.pf-draft-title{margin:0!important;font-size:15px!important;line-height:1.35;overflow-wrap:anywhere}.pf-draft-meta{display:flex;gap:6px 16px;flex-wrap:wrap;padding:0 16px 11px;color:var(--dsw-alias-label-secondary);font-size:11px}.pf-draft-meta-item strong{color:var(--dsw-alias-label-primary);font-weight:600}.pf-draft-technical{margin:0!important;padding:10px 20px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary)!important}.pf-draft-card-expanded{box-shadow:0 10px 30px rgba(0,0,0,.1)}.pf-draft-body{padding:18px 20px 20px;border-top:1px solid var(--dsw-alias-border-l2)}.pf-draft-section-head{margin:18px 0 10px}.pf-draft-section-head:first-child{margin-top:0}.pf-draft-section-head strong{display:block;font-size:14px}.pf-draft-section-head span{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-draft-decision{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-top:18px;padding:16px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l2));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,var(--dsw-alias-bg-layer-2))}.pf-draft-decision-copy{max-width:520px}.pf-draft-decision-copy strong{display:block;font-size:14px}.pf-draft-decision-copy span{display:block;margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.pf-draft-decision>.pf-actions{margin:0;justify-content:flex-end}.pf-publish-section{flex:1 0 100%;min-width:0;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2)}.pf-publish-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:11px}.pf-publish-section-head strong{font-size:14px}.pf-publish-section-head span{color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-published-list{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:12px}.pf-published-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:650}.pf-published-chip{color:#159957;background:rgba(21,153,87,.12)}.pf-publish-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.pf-publish-target{display:flex;min-width:0;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.pf-publish-target-used{border-color:color-mix(in srgb,#159957 48%,var(--dsw-alias-border-l2))}.pf-publish-target-blocked{border-color:color-mix(in srgb,var(--dsw-alias-label-error) 44%,var(--dsw-alias-border-l2))}.pf-publish-target-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.pf-publish-channel{font-weight:700;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform)}.pf-publish-target-name{overflow-wrap:anywhere;font-size:13px}.pf-publish-target-meta{min-height:17px;color:var(--dsw-alias-label-tertiary);font-size:11px;overflow-wrap:anywhere}.pf-publish-warning{margin:0;color:var(--dsw-alias-label-error);font-size:11px;line-height:1.45}.pf-publication-feedback{flex:1 0 100%;margin:0}.pf-publish-target .pf-btn{width:100%;margin-top:auto}.pf-draft-attempts{margin-top:18px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2)}
      .pf-form{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:16px}.pf-field{display:flex;flex-direction:column;gap:5px;min-width:130px;flex:1}.pf-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}.pf-input,.pf-select,.pf-textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font:inherit;font-size:13px;box-sizing:border-box}.pf-input,.pf-select{height:36px}.pf-textarea{width:100%;min-height:150px;padding:10px;resize:vertical;line-height:1.5}.pf-draft-markdown{min-height:360px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.pf-input:focus,.pf-select:focus,.pf-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}.pf-counter{text-align:right;color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-preview{padding:16px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);overflow:auto;line-height:1.65}.pf-preview h1,.pf-preview h2,.pf-preview h3,.pf-preview h4,.pf-preview h5,.pf-preview h6{margin:1em 0 .45em}.pf-preview p{color:inherit;margin:.6em 0}.pf-preview img,.pf-preview video{display:block;max-width:100%;height:auto;margin:10px 0}.pf-preview video.pf-preview-video{width:100%;max-width:960px;min-height:180px;background:#000}.pf-link.pf-preview-link{color:var(--dsw-alias-brand-primary);text-decoration:underline;text-decoration-thickness:.12em;text-underline-offset:.16em;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);font-weight:600;border-radius:3px;padding:0 2px}.pf-link.pf-preview-link:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent);text-decoration-thickness:.16em}.pf-link.pf-preview-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.pf-preview-media{display:inline-flex;align-items:center;gap:8px;padding:8px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px}.pf-preview ol{padding-left:28px}
      .pf-content-page{width:min(100%,1240px);margin-inline:auto}.pf-content-toolbar{display:grid;grid-template-columns:minmax(240px,1fr) minmax(150px,220px) minmax(140px,190px) minmax(100px,140px) auto;align-items:end;gap:10px;margin:14px 0 16px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.pf-content-toolbar .pf-field{min-width:0}.pf-content-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}.pf-content-table{width:100%;min-width:940px;border-collapse:collapse}.pf-content-table th{position:sticky;top:0;z-index:1;padding:10px 12px;text-align:left;white-space:nowrap;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}.pf-content-table td{padding:11px 12px;border-top:1px solid var(--dsw-alias-border-l2);vertical-align:top;font-size:12px}.pf-content-title{display:block;max-width:430px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:650;line-height:1.4;overflow-wrap:anywhere}.pf-content-title-link{text-decoration:none}.pf-content-title-link:hover{color:var(--dsw-alias-brand-primary);text-decoration:underline}.pf-content-summary{display:-webkit-box;max-width:430px;margin-top:5px;color:var(--dsw-alias-label-tertiary);line-height:1.45;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}.pf-content-source strong,.pf-content-source span{display:block;max-width:190px;overflow-wrap:anywhere}.pf-content-source span{margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:10px}.pf-content-date{white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}.pf-content-details{max-width:430px;margin-top:7px}.pf-content-details summary{cursor:pointer;color:var(--dsw-alias-brand-primary);font-size:11px}.pf-content-details-body{margin-top:8px;padding:9px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}.pf-content-details-body strong{display:block;margin-top:7px}.pf-content-details-body strong:first-child{margin-top:0}.pf-content-pagination{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:14px;padding:10px 12px}.pf-content-pagination .pf-actions{margin:0}
      .pf-workflow-page{--pf-workflow-rail-width:clamp(260px,25vw,320px);--pf-workflow-editor-height:clamp(300px,45vh,580px);width:min(100%,1240px);margin-inline:auto}.pf-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.pf-workflow-topbar{display:grid;grid-template-columns:minmax(240px,1fr) auto;gap:12px;align-items:end;margin-bottom:18px}.pf-workflow-topbar .pf-actions{margin:0;justify-content:flex-end}.pf-workflow-meta{margin-bottom:18px;padding:18px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.pf-workflow-meta-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.pf-workflow-meta-head h3{margin:0;font-size:14px}.pf-workflow-state-badge{white-space:nowrap}.pf-workflow-meta-grid{display:grid;grid-template-columns:minmax(190px,.75fr) minmax(240px,1fr) minmax(280px,1.4fr);gap:14px}.pf-workflow-id .pf-input{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:650}.pf-workflow-policy{margin-top:13px;color:var(--dsw-alias-label-secondary);font-size:12px}.pf-workflow-policy summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none}.pf-workflow-policy summary::-webkit-details-marker{display:none}.pf-workflow-policy pre{margin:10px 0 0;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);white-space:pre-wrap}.pf-workflow-canvas{display:grid;grid-template-columns:var(--pf-workflow-rail-width) minmax(0,1fr);gap:22px;align-items:start}.pf-workflow-rail{min-width:0}.pf-workflow-rail-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.pf-workflow-rail-head h3{margin:0;font-size:14px}.pf-step-list{display:flex;flex-direction:column;gap:0}.pf-step-tab{position:relative;width:100%;display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:10px;padding:11px 10px;text-align:left;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}.pf-step-tab:hover{border-color:var(--dsw-alias-brand-primary)}.pf-step-tab:focus-visible,.pf-step-tab-on:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:3px solid var(--dsw-alias-label-primary);outline-offset:3px}.pf-step-tab-on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-3);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}.pf-step-number{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:650}.pf-step-tab-on .pf-step-number{background:var(--dsw-alias-brand-primary);color:white}.pf-step-summary{min-width:0}.pf-step-summary strong,.pf-step-summary small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pf-step-summary strong{font-size:13px}.pf-step-summary small{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-step-prompt-state{font-size:10px;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}.pf-step-connector{height:18px;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:1}.pf-workflow-add{width:100%;margin-top:10px}.pf-workflow-editor{min-width:0;padding:2px 2px 0}.pf-workflow-editor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px}.pf-workflow-editor-title{min-width:0}.pf-workflow-editor-title p{margin:5px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-workflow-toolbar{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.pf-workflow-toolbar .pf-btn{padding:6px 9px;font-size:12px}.pf-workflow-step-name{max-width:540px;margin-bottom:18px}.pf-workflow-textarea{min-height:var(--pf-workflow-editor-height);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.pf-workflow-process{min-height:190px}.pf-field-foot{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;min-height:18px}.pf-field-help{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.45}.pf-field-error{margin:0;color:var(--dsw-alias-label-error);font-size:11px}.pf-workflow-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:24px;padding-top:18px;border-top:1px solid var(--dsw-alias-border-l2)}.pf-workflow-actions-preview{justify-content:flex-end}.pf-workflow-actions .pf-actions{margin:0}.pf-workflow-status{color:var(--dsw-alias-label-secondary);font-size:12px}.pf-workflow-history{margin-top:22px;padding-top:18px;border-top:1px solid var(--dsw-alias-border-l2)}.pf-workflow-history-toggle{width:100%;display:flex;justify-content:space-between;align-items:center}.pf-workflow-history-panel{margin-top:10px;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.pf-workflow-history-row{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}.pf-workflow-history-row:last-child{border-bottom:0}.pf-workflow-management{margin-top:18px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2)}.pf-workflow-management h3{margin:0 0 4px;font-size:14px}.pf-workflow-management p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}
      @media(forced-colors:active){.pf-step-tab:focus-visible,.pf-step-tab-on:focus-visible{border-color:Highlight;outline-color:Highlight}}
      .pf-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}.pf-table{width:100%;border-collapse:collapse;font-size:12px}.pf-table th,.pf-table td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}.pf-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-weight:500}.pf-table tr:last-child td{border-bottom:0}.pf-link{color:var(--dsw-alias-brand-primary);text-decoration:none}.pf-link:hover{text-decoration:underline}.pf-muted{color:var(--dsw-alias-label-tertiary)}.pf-empty{padding:28px;text-align:center;color:var(--dsw-alias-label-tertiary)}
      .pf-destructive-overlay{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.62)}.pf-destructive-dialog{width:min(640px,100%);max-height:calc(100vh - 40px);overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:22px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 80px rgba(0,0,0,.45)}.pf-destructive-dialog h2{margin:0 0 10px;color:var(--dsw-alias-label-error)}.pf-destructive-dialog ul{padding-left:22px;font-size:13px;line-height:1.55}.pf-destructive-dialog .pf-actions{justify-content:flex-end}.pf-draft-head-actions{margin:0;justify-content:flex-end}.pf-cover-thumb-button{display:inline-grid;width:68px;height:68px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;overflow:hidden}.pf-cover-thumb-button:hover{border-color:var(--dsw-alias-brand-primary)}.pf-cover-thumb{width:100%;height:100%;object-fit:cover;border-radius:5px}.pf-cover-dialog{position:relative;z-index:1;width:min(960px,100%);max-height:calc(100vh - 40px);overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:22px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 80px rgba(0,0,0,.45)}.pf-cover-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.pf-cover-dialog-head h2{margin:0;font-size:18px}.pf-cover-dialog-head p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.pf-cover-grid{display:grid;grid-template-columns:repeat(auto-fill,240px);justify-content:center;align-items:start;gap:16px}.pf-cover-figure{width:240px;min-width:0;margin:0;padding:12px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.pf-cover-image-button{display:grid;place-items:center;width:216px;height:288px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;cursor:zoom-in}.pf-cover-image-button:hover{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}.pf-cover-image-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.pf-cover-image{display:block;width:216px;height:288px;object-fit:contain;background:var(--dsw-alias-bg-layer-3)}.pf-original-overlay{z-index:1200;background:rgba(0,0,0,.82)}.pf-original-dialog{position:relative;z-index:1;display:flex;flex-direction:column;width:min(1200px,calc(100vw - 40px));height:min(900px,calc(100vh - 40px));padding:16px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 90px rgba(0,0,0,.6)}.pf-original-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}.pf-original-dialog-head h2{margin:0;font-size:18px}.pf-original-dialog-head p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}.pf-original-stage{display:grid;place-items:center;min-height:0;flex:1;overflow:auto;border-radius:10px;background:#101114}.pf-original-image{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}.pf-original-dialog>.pf-actions{margin-top:12px;justify-content:flex-end}.pf-cover-figure figcaption{margin-top:10px}.pf-cover-figure figcaption strong,.pf-cover-figure figcaption span{display:block}.pf-cover-figure figcaption span{margin-top:5px}.pf-cover-dialog>.pf-actions{justify-content:flex-end}
      .pf-prompt-dock{display:flex;align-items:center;gap:7px;width:50%;max-width:50%;min-width:0;box-sizing:border-box;margin:0 auto;padding:1px 0 3px;border:0;background:transparent;box-shadow:none}.pf-prompt-dock-list{display:flex;min-width:0;width:100%;gap:6px;overflow-x:auto;overflow-y:hidden;padding:1px 2px 4px;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior-x:contain;scroll-snap-type:x proximity;cursor:grab;user-select:none}.pf-prompt-dock-list::-webkit-scrollbar{display:none;width:0;height:0}.pf-prompt-dock-list.pf-prompt-dragging,.pf-prompt-dock-list.pf-prompt-dragging *{cursor:grabbing!important;scroll-snap-type:none}.pf-prompt-item{display:flex;flex:0 0 auto;align-items:stretch;min-width:0;max-height:40px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;overflow:hidden;scroll-snap-align:start;transition:border-color .14s ease,color .14s ease}.pf-prompt-item:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 65%,var(--dsw-alias-border-l2))}.pf-prompt-chip{display:-webkit-box;flex:0 0 auto;width:max-content;min-width:0;max-width:260px;max-height:38px;box-sizing:border-box;padding:5px 9px;border:0;border-radius:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;font-weight:500;line-height:1.35;text-align:left;white-space:pre-line;overflow:hidden;overflow-wrap:anywhere;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;cursor:pointer;transition:color .14s ease}.pf-prompt-chip:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.pf-prompt-chip:focus-visible,.pf-prompt-copy:focus-visible{position:relative;z-index:1;outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.pf-prompt-chip:disabled{opacity:.48;cursor:not-allowed}.pf-prompt-copy{flex:0 0 auto;width:34px;height:38px;box-sizing:border-box;padding:0 4px;border:0;border-left:1px solid var(--dsw-alias-border-l2);border-radius:0;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);color:var(--dsw-alias-label-tertiary);font:inherit;font-size:9px;line-height:1;cursor:pointer}.pf-prompt-copy:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.pf-prompt-copy-copied{color:#159957;border-color:color-mix(in srgb,#159957 55%,var(--dsw-alias-border-l2))}.pf-prompt-editor-list{display:flex;flex-direction:column;gap:10px}.pf-prompt-editor-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}.pf-prompt-editor-order{display:flex;flex-direction:column;gap:5px}.pf-prompt-editor-order .pf-btn{padding:4px 8px}.pf-prompt-editor-row .pf-textarea{min-height:74px}.pf-prompt-editor-controls{display:flex;flex-direction:column;align-items:flex-end;gap:7px}.pf-prompt-editor-controls .pf-check{padding:0}.pf-notice{margin-bottom:16px;border-radius:9px;padding:10px 13px;font-size:13px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}.pf-notice-error{color:var(--dsw-alias-label-error);background:rgba(220,50,47,.1)}.pf-kpi{font-size:26px;font-weight:650;margin:5px 0}.pf-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;word-break:break-all}.pf-section-title{font-size:17px;margin:0 0 7px}.pf-section-help{margin:0 0 16px;color:var(--dsw-alias-label-secondary);font-size:13px}.pf-check{display:flex;align-items:center;gap:7px;font-size:13px;padding-bottom:8px}.pf-publisher-group{margin-top:22px}.pf-publisher-group-title{font-size:16px;margin:0 0 10px}.pf-publisher-group-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px}.pf-publisher-group-grid>.pf-card{margin-top:0!important}.pf-native-note{padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-module-platform)}.pf-publisher-credentials{margin-top:14px;padding:14px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,var(--dsw-alias-border-l2));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,var(--dsw-alias-bg-layer-3))}.pf-publisher-credentials-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.pf-publisher-credentials-head strong{font-size:13px}.pf-publisher-credentials-head span{color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-publisher-credential-row+.pf-publisher-credential-row{margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}.pf-publisher-credential-row .pf-form{margin:8px 0 0}.pf-publisher-secret-field{min-width:min(300px,100%)}.pf-deployment-details{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}.pf-deployment-details>summary,.pf-publisher-tool-details>summary,.pf-runtime-details>summary{cursor:pointer;font-weight:650;font-size:13px}.pf-deployment-details>.pf-form,.pf-runtime-details>.pf-grid{margin-top:12px}.pf-publisher-save-footer{margin-top:20px;padding:18px 20px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,var(--dsw-alias-border-l2));border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-2));box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}.pf-publisher-state-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.pf-publisher-state-head h3{margin:0;font-size:16px}.pf-publisher-state-badge{flex:none;white-space:nowrap}.pf-publisher-state-dirty{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-bg-layer-2))}.pf-publisher-state-restart{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform)}.pf-publisher-save-copy{max-width:820px;margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}.pf-publisher-save-footer>.pf-actions{margin-top:14px}.pf-compact-callout{margin-top:14px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.pf-compact-callout strong{display:block;margin-bottom:3px;color:var(--dsw-alias-label-primary)}.pf-compact-callout>.pf-actions{margin-top:9px}.pf-compact-steps{margin:5px 0 0;padding-left:20px}.pf-compact-steps li+li{margin-top:3px}.pf-publisher-tool-details,.pf-runtime-details{margin-top:14px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.pf-publisher-tool-details>p,.pf-runtime-details>p{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}.pf-publisher-tool-details>.pf-input{margin-top:8px;max-width:100%}.pf-switch-field{justify-content:flex-end}.pf-switch-field .pf-check{padding-bottom:0}.pf-json{white-space:pre-wrap;max-height:260px;overflow:auto;font-size:11px;margin-top:12px;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-3)}.pf-result-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:14px}.pf-result{background:var(--dsw-alias-bg-layer-3);border-radius:9px;padding:11px}.pf-result strong{display:block;font-size:20px;margin-top:4px}.pf-result span{color:var(--dsw-alias-label-tertiary);font-size:11px}
      .pf-publisher-page{width:min(100%,1240px);margin-inline:auto}.pf-publisher-toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:16px}.pf-publisher-toolbar-copy{max-width:780px}.pf-publisher-toolbar-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pf-publisher-toolbar-actions .pf-actions{margin:0}.pf-publisher-overflow{position:relative}.pf-publisher-overflow>summary{list-style:none}.pf-publisher-overflow>summary::-webkit-details-marker{display:none}.pf-publisher-overflow-panel{position:absolute;right:0;z-index:20;width:min(520px,80vw);max-height:70vh;overflow:auto;margin-top:8px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 14px 42px rgba(0,0,0,.22)}.pf-publisher-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:18px;align-items:start}.pf-publisher-rail{position:sticky;top:0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.pf-publisher-rail-group+.pf-publisher-rail-group{margin-top:16px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l2)}.pf-publisher-rail-title{margin:0 6px 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.pf-publisher-rail-item{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;margin-top:5px;padding:10px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}.pf-publisher-rail-item:hover{background:var(--dsw-alias-bg-module-platform)}.pf-publisher-rail-item-on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-3);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}.pf-publisher-rail-name{display:block;font-size:13px;font-weight:650}.pf-publisher-rail-meta{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-publisher-create{width:100%;margin-top:14px}.pf-publisher-workspace{min-width:0}.pf-publisher-workspace-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.pf-publisher-workspace-head h3{margin:0;font-size:18px}.pf-publisher-workspace-head p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}.pf-publisher-targetbar{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-top:12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.pf-publisher-target-select{max-width:440px;margin:0}.pf-publisher-target-select .pf-select{width:100%}.pf-publisher-editor{margin-top:12px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.pf-publisher-editor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l2)}.pf-publisher-editor-head h4{margin:0;font-size:15px}.pf-publisher-editor-head p{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-publisher-section{margin-top:18px}.pf-publisher-section:first-of-type{margin-top:0}.pf-publisher-section-title{margin:0 0 11px;font-size:13px}.pf-publisher-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px}.pf-publisher-field-grid>.pf-field{min-width:0}.pf-publisher-disclosure{margin-top:16px;padding:13px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}.pf-publisher-disclosure>summary{cursor:pointer;font-size:13px;font-weight:650}.pf-publisher-disclosure-body{margin-top:14px}.pf-publisher-disclosure .pf-publisher-credentials{margin:0}.pf-publisher-danger{border-color:color-mix(in srgb,var(--dsw-alias-label-error) 30%,var(--dsw-alias-border-l2))}.pf-publisher-empty{padding:42px 20px;text-align:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.pf-publisher-empty h3{margin:0 0 8px}.pf-publisher-empty p{margin:0 auto 15px;max-width:520px;color:var(--dsw-alias-label-secondary);font-size:13px}.pf-publisher-save-footer.pf-publisher-changebar{position:static;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:18px;padding:13px 16px;box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}.pf-publisher-change-copy strong,.pf-publisher-change-copy span{display:block}.pf-publisher-change-copy span{margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:11px}.pf-publisher-changebar>.pf-actions{margin:0;justify-content:flex-end}.pf-publisher-create-overlay{position:fixed;inset:0;z-index:1150;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.6)}.pf-publisher-create-dialog{width:min(620px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 80px rgba(0,0,0,.4)}.pf-publisher-create-dialog h2{margin:0 0 7px}.pf-publisher-create-dialog>p{margin:0 0 16px;color:var(--dsw-alias-label-secondary);font-size:13px}.pf-publisher-create-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.pf-publisher-create-option{padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}.pf-publisher-create-option:hover{border-color:var(--dsw-alias-brand-primary)}.pf-publisher-create-option strong,.pf-publisher-create-option span{display:block}.pf-publisher-create-option span{margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:11px}.pf-publisher-create-dialog>.pf-actions{justify-content:flex-end}.pf-sidebar-action{flex:none;display:flex;align-items:center;box-sizing:border-box;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden}.pf-sidebar-footer-stack{flex-direction:column;align-items:stretch}.pf-sidebar-action-wide{width:calc(100% + 8px);height:34px;margin:4px -4px 4px;padding:6px 2px 6px 10px;justify-content:flex-start;gap:8px;border-radius:12px}.pf-sidebar-action-rail{width:36px;height:36px;margin:8px 0 10px;padding:0;justify-content:center;align-self:center;gap:0;border-radius:50%}.pf-sidebar-action:hover{background:var(--dsw-alias-interactive-bg-hover)}.pf-sidebar-icon{display:flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px}.pf-sidebar-action-rail .pf-sidebar-icon{width:18px;height:18px}.pf-sidebar-label{overflow:hidden;white-space:nowrap}.pf-overlay{position:fixed;inset:0;z-index:1000;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:24px}.pf-backdrop{position:absolute;inset:0;border:0;background:rgba(0,0,0,.52);cursor:default}.pf-panel{position:relative;width:min(1440px,calc(100vw - 48px));height:min(920px,calc(100vh - 48px));border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column}.pf-panel-head{height:48px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}.pf-panel-head strong{font-size:14px}.pf-close{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:22px;cursor:pointer}.pf-close:hover{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}.pf-panel-body{flex:1;min-height:0}.pf-panel-body .pf-shell{height:100%;box-sizing:border-box}
      @media(max-width:1000px){.pf-content-toolbar{grid-template-columns:repeat(2,minmax(0,1fr))}.pf-content-toolbar>.pf-actions{grid-column:1/-1}.pf-overview-flow{grid-template-columns:repeat(2,minmax(0,1fr))}.pf-overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pf-workflow-meta-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pf-workflow-meta-grid .pf-field:last-child{grid-column:1/-1}.pf-workflow-canvas{gap:16px}.pf-review-filter-form{grid-template-columns:minmax(240px,1fr) 160px 100px}.pf-review-filter-actions{grid-column:1/-1;justify-content:flex-end}}
      @media(max-width:820px){.pf-overview-hero{grid-template-columns:1fr}.pf-overview-hero-actions{justify-content:flex-start}.pf-overview-bottom{grid-template-columns:1fr}.pf-toolset-header{grid-template-columns:1fr}.pf-toolset-header-actions{justify-content:flex-start}.pf-skill-section .pf-toolset-section-head{flex-direction:column}.pf-skill-section .pf-toolset-header-actions{width:100%}.pf-image-settings-grid>.pf-image-endpoint,.pf-image-settings-grid>.pf-image-protocol{grid-column:1/-1}.pf-image-settings-grid>.pf-image-number,.pf-image-settings-grid>.pf-image-compact{grid-column:span 6}.pf-workflow-topbar{grid-template-columns:1fr}.pf-publisher-toolbar{flex-direction:column}.pf-publisher-toolbar-actions{justify-content:flex-start}.pf-publisher-layout{grid-template-columns:1fr}.pf-publisher-rail{position:static}.pf-publisher-rail-group{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.pf-publisher-rail-group+.pf-publisher-rail-group{margin-top:12px}.pf-publisher-rail-title{grid-column:1/-1}.pf-publisher-create{width:auto}.pf-workflow-topbar .pf-actions{justify-content:flex-start}.pf-workflow-meta-grid{grid-template-columns:1fr}.pf-workflow-meta-grid .pf-field:last-child{grid-column:auto}.pf-workflow-canvas{grid-template-columns:1fr;gap:24px}.pf-step-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}.pf-step-connector{display:none}.pf-workflow-editor{padding-top:18px;border-top:1px solid var(--dsw-alias-border-l2)}}
      @media(max-width:700px){.pf-content-toolbar{grid-template-columns:1fr}.pf-content-toolbar>.pf-actions{grid-column:auto}.pf-content-pagination{align-items:stretch;flex-direction:column}.pf-content-pagination>.pf-actions{width:100%}.pf-content-pagination .pf-btn{flex:1}.pf-prompt-dock{gap:5px}.pf-prompt-dock-list{width:100%}.pf-prompt-chip{max-width:min(230px,72vw)}.pf-prompt-editor-row{grid-template-columns:1fr}.pf-prompt-editor-order,.pf-prompt-editor-controls{flex-direction:row;align-items:center}.pf-prompt-editor-controls{justify-content:space-between}.pf-overview-hero{padding:21px 18px}.pf-overview-hero h2{font-size:21px}.pf-overview-hero-actions{width:100%}.pf-overview-hero-actions .pf-btn{flex:1}.pf-overview-metrics,.pf-overview-flow{grid-template-columns:1fr}.pf-overview-flow-card{min-height:0}.pf-overview-section-head{align-items:flex-start;flex-direction:column}.pf-toolset-section-head,.pf-image-credential-head{grid-template-columns:1fr;display:grid}.pf-toolset-section-head{padding:15px 14px}.pf-toolset-section-body,.pf-image-credentials{padding:15px 14px}.pf-toolset-section-actions{padding:12px 14px;justify-content:stretch}.pf-toolset-section-actions .pf-btn{flex:1 1 150px}.pf-image-settings-grid>.pf-field{grid-column:1/-1}.pf-image-credential-state{text-align:left}.pf-image-credential-row{grid-template-columns:1fr}.pf-image-credential-actions{flex-wrap:wrap}.pf-image-credential-actions .pf-btn{flex:1 1 140px}.pf-toolset-grid,.pf-plugin-grid{grid-template-columns:1fr}.pf-skill-danger{align-items:stretch;flex-direction:column}.pf-skill-danger .pf-btn{width:100%}.pf-shell-top{padding:18px 14px 14px}.pf-shell-content{padding:16px 14px 50px}.pf-publisher-field-grid,.pf-publisher-create-grid{grid-template-columns:1fr}.pf-publisher-workspace-head,.pf-publisher-targetbar,.pf-publisher-editor-head,.pf-publisher-save-footer.pf-publisher-changebar{align-items:stretch;flex-direction:column}.pf-publisher-target-select{max-width:none}.pf-publisher-changebar>.pf-actions{width:100%}.pf-publisher-changebar>.pf-actions .pf-btn{flex:1 1 160px}.pf-publisher-overflow-panel{position:fixed;inset:70px 14px auto;width:auto}.pf-overlay{padding:0}.pf-panel{width:100vw;height:100vh;border:0;border-radius:0}.pf-head{flex-direction:column}.pf-field{min-width:100%}.pf-table th,.pf-table td{padding:8px}.pf-workflow-meta{padding:14px}.pf-workflow-editor-head{flex-direction:column}.pf-workflow-toolbar{justify-content:flex-start}.pf-workflow-actions{align-items:stretch;flex-direction:column}.pf-workflow-actions-preview{align-items:flex-end}.pf-workflow-actions .pf-actions{width:100%}.pf-workflow-actions .pf-btn{flex:1 1 150px}.pf-workflow-management>.pf-row{align-items:flex-start;flex-direction:column}.pf-workflow-textarea{min-height:42vh}.pf-workflow-process{min-height:170px}.pf-publisher-group-grid{grid-template-columns:minmax(0,1fr)}.pf-publisher-save-footer{padding:15px 14px}.pf-publisher-state-head{align-items:flex-start;flex-direction:column}.pf-publisher-save-footer>.pf-actions{align-items:stretch;flex-direction:column}.pf-publisher-save-footer>.pf-actions .pf-btn{width:100%}.pf-publisher-tool-details,.pf-runtime-details{padding:12px}.pf-review-header,.pf-review-pagination{align-items:stretch;flex-direction:column}.pf-review-filter-form{grid-template-columns:1fr}.pf-review-filter-actions{grid-column:auto}.pf-review-filter-actions .pf-btn{flex:1}.pf-review-pagination>.pf-actions{width:100%}.pf-review-pagination>.pf-actions .pf-btn{flex:1 1 100px}.pf-draft-card-head{padding:15px 14px 10px;grid-template-columns:1fr}.pf-draft-head-actions{width:100%;justify-content:stretch}.pf-draft-head-actions .pf-btn{flex:1}.pf-cover-dialog{padding:16px}.pf-cover-grid{grid-template-columns:1fr;justify-items:center}.pf-original-overlay{padding:0}.pf-original-dialog{width:100vw;height:100vh;border:0;border-radius:0;padding:12px}.pf-draft-meta,.pf-draft-technical{padding-left:14px;padding-right:14px}.pf-draft-body{padding:16px 14px}.pf-draft-decision{padding:14px}.pf-draft-decision>.pf-actions{width:100%;justify-content:flex-start}.pf-draft-decision>.pf-actions .pf-btn{flex:1 1 180px}.pf-publish-section-head{flex-direction:column}.pf-publish-grid{grid-template-columns:1fr}}
    `
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="@prismflow/dsh/ui/dashboard"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@prismflow/dsh/ui'
      tag.dataset.pluginCss = '@prismflow/dsh/ui/dashboard'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    class ApiError extends Error {
      constructor(status, message, value) { super(message); this.status = status; this.value = value }
    }

    async function api(path, options = {}) {
      const response = await fetch(`${API_PREFIX}${path}`, {
        method: options.method || (options.body === undefined ? 'GET' : 'POST'),
        headers: options.rawBody !== undefined ? { 'content-type': options.contentType || 'application/octet-stream' } : options.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: options.rawBody !== undefined ? options.rawBody : options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      })
      let value
      try { value = await response.json() } catch { value = {} }
      if (!response.ok) throw new ApiError(response.status, value.error || `Request failed (${response.status})`, value)
      return value
    }

    function downloadBlob(blob, fileName) {
      const href = URL.createObjectURL(blob)
      try {
        const link = document.createElement('a'); link.href = href; link.download = fileName; link.click()
      } finally { URL.revokeObjectURL(href) }
    }

    function downloadJson(value, fileName) {
      downloadBlob(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }), fileName)
    }

    function safeLinkUrl(value) {
      if (typeof value !== 'string') return undefined
      try {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
        return url.toString()
      } catch {
        return undefined
      }
    }

    function ipv6Groups(hostname) {
      const halves = hostname.split('::')
      if (halves.length > 2) return undefined
      const left = halves[0] ? halves[0].split(':') : []
      const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
      const missing = 8 - left.length - right.length
      if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined
      const groups = [...left, ...Array(missing).fill('0'), ...right]
      if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/u.test(group))) return undefined
      return groups.map(group => Number.parseInt(group, 16))
    }

    function safePreviewResourceUrl(value) {
      const safe = safeLinkUrl(value)
      if (!safe) return undefined
      const url = new URL(safe)
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '')
      if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return undefined
      const octets = hostname.split('.').map(part => /^\d{1,3}$/u.test(part) ? Number(part) : -1)
      if (octets.length === 4 && octets.every(part => part >= 0 && part <= 255)) {
        const [a, b, c] = octets
        if (a === 0 || a === 10 || a === 127 || a >= 224
          || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
          || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
          || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2)
          || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19))
          || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return undefined
      } else if (hostname.includes(':')) {
        const groups = ipv6Groups(hostname)
        if (!groups || groups[0] < 0x2000 || groups[0] > 0x3fff
          || (groups[0] === 0x2001 && groups[1] <= 0x01ff)
          || (groups[0] === 0x2001 && groups[1] === 0x0db8)
          || groups[0] === 0x2002 || groups[0] === 0x3ffe
          || (groups[0] === 0x3fff && groups[1] < 0x1000)) return undefined
      }
      return safe
    }

    function previewMediaUrl(kind, value) {
      if (!['image', 'video'].includes(kind)) return undefined
      return safePreviewResourceUrl(value)
    }

    function PreviewMedia({ draftId: _draftId, kind, url, alt }) {
      const src = previewMediaUrl(kind, url)
      if (!src) return h('span', { className: 'pf-preview-media pf-muted' }, `${kind === 'image' ? '图片' : '视频'}资源已阻止`)
      return kind === 'image'
        ? h('img', { src, alt: alt ?? '', referrerPolicy: 'no-referrer' })
        : h('video', { className: 'pf-preview-video', src, controls: true, playsInline: true, preload: 'metadata', referrerPolicy: 'no-referrer' })
    }

    function renderInlineMarkdown(value, keyPrefix, draftId) {
      const output = []
      let textValue = ''
      let index = 0
      const flush = () => { if (textValue) { output.push(textValue); textValue = '' } }
      while (index < value.length) {
        const rest = value.slice(index)
        let match = rest.match(/^<br\s*\/?>/iu)
        if (match) { flush(); output.push(h('br', { key: `${keyPrefix}-br-${index}` })); index += match[0].length; continue }
        match = rest.match(/^<video src=(["'])(https?:\/\/[^\s"'<>]+)\1 controls(?:=(?:"controls"|'controls'))?(?: width=(?:"100%"|'100%'))?(?: preload=(?:"none"|'none'))?><\/video>/u)
        if (match) {
          flush(); output.push(h(PreviewMedia, { key: `${keyPrefix}-video-${index}`, draftId, kind: 'video', url: match[2] })); index += match[0].length; continue
        }
        match = rest.match(/^!\[([^\]\n]*)\]\(<?([^\s)>]+)>?\)/u)
        if (match) {
          const resource = safeLinkUrl(match[2])
          if (resource) { flush(); output.push(h(PreviewMedia, { key: `${keyPrefix}-image-${index}`, draftId, kind: 'image', url: match[2], alt: match[1] })); index += match[0].length; continue }
        }
        match = rest.match(/^\[([^\]\n]+)\]\(<?([^\s)>]+)>?\)/u)
        if (match) {
          const href = safeLinkUrl(match[2])
          if (href) { flush(); output.push(h('a', { key: `${keyPrefix}-link-${index}`, className: 'pf-link pf-preview-link', href, target: '_blank', rel: 'noopener noreferrer' }, match[1])); index += match[0].length; continue }
        }
        match = rest.match(/^\*\*([^*\n]+)\*\*/u)
        if (match) { flush(); output.push(h('strong', { key: `${keyPrefix}-bold-${index}` }, match[1])); index += match[0].length; continue }
        textValue += value[index]
        index += 1
      }
      flush()
      return output
    }

    function isPreviewMediaOnlyLine(line) {
      let residue = line.replace(/<br\s*\/?>/giu, '')
      residue = residue.replace(/!\[[^\]\n]*\]\(<?[^\s)>]+>?\)/gu, '')
      residue = residue.replace(/<video src=(["'])https?:\/\/[^\s"'<>]+\1 controls(?:=(?:"controls"|'controls'))?(?: width=(?:"100%"|'100%'))?(?: preload=(?:"none"|'none'))?><\/video>/gu, '')
      return residue.trim() === ''
    }

    function renderMarkdownPreview(markdown, draftId) {
      const nodes = []
      const lines = markdown.split(/\r?\n/u)
      let orderedListNext
      let orderedListCanContinue = false
      for (let index = 0; index < lines.length;) {
        const line = lines[index]
        const heading = line.match(/^ {0,3}(#{1,6})\s+(.+)$/u)
        if (heading) {
          orderedListNext = undefined; orderedListCanContinue = false
          const level = heading[1].length
          nodes.push(h(`h${level}`, { key: `line-${index}` }, ...renderInlineMarkdown(heading[2], `line-${index}`, draftId)))
          index += 1
          continue
        }
        const firstItem = line.match(/^\s*(\d+)\.\s+(.+)$/u)
        if (firstItem) {
          const declaredStart = Number(firstItem[1])
          const start = orderedListCanContinue && Number.isSafeInteger(orderedListNext)
            && (declaredStart === 1 || declaredStart === orderedListNext) ? orderedListNext : declaredStart
          const items = []
          while (index < lines.length) {
            const item = lines[index].match(/^\s*\d+\.\s+(.+)$/u)
            if (!item) break
            items.push(h('li', { key: `line-${index}` }, ...renderInlineMarkdown(item[1], `line-${index}`, draftId)))
            index += 1
          }
          nodes.push(h('ol', { key: `list-${index}`, ...(start !== 1 ? { start } : {}) }, ...items))
          orderedListNext = start + items.length; orderedListCanContinue = true
          continue
        }
        const mediaOnly = line === '' || isPreviewMediaOnlyLine(line)
        if (!mediaOnly) { orderedListNext = undefined; orderedListCanContinue = false }
        if (line === '') nodes.push(h('br', { key: `line-${index}`, 'aria-hidden': true }))
        else nodes.push(h('p', { key: `line-${index}` }, ...renderInlineMarkdown(line, `line-${index}`, draftId)))
        index += 1
      }
      return nodes
    }

    function ariaProps(props) {
      return Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith('aria-')))
    }
    function Button(props) {
      return h('button', {
        type: 'button',
        className: `pf-btn${props.primary ? ' pf-primary' : ''}${props.danger ? ' pf-danger' : ''}${props.className ? ` ${props.className}` : ''}`,
        disabled: props.disabled,
        ref: props.buttonRef,
        onClick: props.onClick,
        title: props.title,
        ...ariaProps(props),
      }, props.children)
    }
    function Field(props) {
      const generatedId = React.useId()
      const controlId = props.id ?? generatedId
      const helpId = `${controlId}-help`
      const describedBy = [props['aria-describedby'], props.help ? helpId : ''].filter(Boolean).join(' ') || undefined
      const control = props.options
        ? h('select', { id: controlId, ref: props.controlRef, className: `pf-select${props.controlClassName ? ` ${props.controlClassName}` : ''}`, value: props.value, disabled: props.disabled, 'aria-describedby': describedBy, 'aria-invalid': props['aria-invalid'], onChange: e => props.onChange(e.target.value) },
            props.options.map(option => h('option', { key: option.value, value: option.value }, option.label)))
        : h('input', { id: controlId, ref: props.controlRef, className: `pf-input${props.controlClassName ? ` ${props.controlClassName}` : ''}`, type: props.type || 'text', value: props.value, disabled: props.disabled, readOnly: props.readOnly, placeholder: props.placeholder, min: props.min, max: props.max, maxLength: props.maxLength, 'aria-describedby': describedBy, 'aria-invalid': props['aria-invalid'], onChange: e => props.onChange(e.target.value) })
      return h('div', { className: `pf-field${props.className ? ` ${props.className}` : ''}` },
        h('label', { htmlFor: controlId }, props.label), control,
        props.help ? h('p', { className: 'pf-field-help', id: helpId }, props.help) : null)
    }
    function Switch({ label, checked, disabled, onChange, help }) {
      const generatedId = React.useId()
      const helpId = `${generatedId}-help`
      return h('div', { className: 'pf-field pf-switch-field' },
        h('label', { className: 'pf-check', htmlFor: generatedId },
          h('input', { id: generatedId, type: 'checkbox', role: 'switch', checked, disabled, 'aria-describedby': help ? helpId : undefined,
            onChange: event => onChange(event.target.checked) }), label),
        help ? h('p', { className: 'pf-field-help', id: helpId }, help) : null)
    }
    function TextArea({ id, label, value, disabled, onChange, className = '', help = '', error = '' }) {
      const generatedId = React.useId()
      const controlId = id ?? generatedId
      const helpId = `${controlId}-help`
      const errorId = `${controlId}-error`
      const counterId = `${controlId}-counter`
      const describedBy = [help ? helpId : '', error ? errorId : '', counterId].filter(Boolean).join(' ')
      return h('div', { className: 'pf-field' },
        h('label', { htmlFor: controlId }, label),
        h('textarea', { id: controlId, className: `pf-textarea${className ? ` ${className}` : ''}`, value, disabled, maxLength: 10000, 'aria-describedby': describedBy, 'aria-invalid': !!error, onChange: e => onChange(e.target.value) }),
        h('div', { className: 'pf-field-foot' },
          h('div', null,
            help ? h('p', { className: 'pf-field-help', id: helpId }, help) : null,
            error ? h('p', { className: 'pf-field-error', id: errorId, role: 'alert' }, error) : null),
          h('div', { className: 'pf-counter', id: counterId }, `${value.length} / 10000`)),
      )
    }
    function Badge({ enabled, children }) {
      return h('span', { className: `pf-badge ${enabled ? 'pf-ok' : 'pf-off'}` }, children)
    }
    const DRAFT_STATUS = {
      draft: { label: '待审核', hint: '需要确认内容并作出审批决定' },
      rejected: { label: '已拒绝', hint: '可修改后保存为新的待审核版本' },
      approved: { label: '已批准', hint: '内容已锁定，可以选择发布渠道' },
      publishing: { label: '发布中', hint: '正在提交或等待发布结果' },
      published: { label: '已发布', hint: '可查看回执或显式再次发布' },
    }
    function draftStatus(value) { return DRAFT_STATUS[value] ?? { label: value || '未知状态', hint: '请检查草稿状态' } }
    function displayDraftTime(value) {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
    }
    const PUBLISHER_CHANNEL_LABELS = Object.freeze({
      'local-markdown': '本地 Markdown', 'github-markdown': 'GitHub', 'r2-markdown': 'Cloudflare R2', 'wechat-draft': '微信公众号草稿',
    })
    function publisherPresentation(publisher) {
      const id = typeof publisher === 'string' ? publisher : publisher.id
      const kind = typeof publisher === 'object' && publisher.kind ? publisher.kind : String(id ?? '').split(':')[0]
      const channel = PUBLISHER_CHANNEL_LABELS[kind] ?? kind ?? '未知渠道'
      const name = typeof publisher === 'object' && publisher.name ? publisher.name : String(id ?? '').split(':').slice(1).join(':') || String(id ?? '')
      const articleType = typeof publisher === 'object' && publisher.articleType === 'news' ? '普通文章'
        : typeof publisher === 'object' && publisher.articleType === 'newspic' ? '图文消息' : ''
      return { id, kind, channel, name, articleType }
    }
    function publisherReadiness(draft, publisher) {
      const item = publisherPresentation(publisher)
      if (item.kind !== 'wechat-draft') return { ready: true, reason: '' }
      const presentation = draft.destinationPresentations?.find(value => value.publisherId === publisher.id)
      const effectiveCoverId = presentation?.cover?.assetId ?? presentation?.imageOrder?.[0]
      const approvedCover = effectiveCoverId && draft.mediaAssets?.some(asset => asset.assetId === effectiveCoverId)
      const markdownImage = /!\[[^\]]*\]\((?:https?:\/\/|prismflow-media:)|<img\s[^>]*src=["'](?:https?:\/\/|prismflow-media:)/iu.test(draft.markdown ?? '')
      const deploymentCover = publisher.hasDeploymentDefaultCover === true
      if (publisher.articleType === 'news' && !approvedCover && !markdownImage && !deploymentCover) {
        return { ready: false, reason: '缺少微信必需的封面图片：草稿没有已批准封面或正文图片，目标也未配置部署默认封面。' }
      }
      if (publisher.articleType === 'newspic') {
        const boundIds = [...new Set([presentation?.cover?.assetId, ...(presentation?.imageOrder ?? [])].filter(Boolean))]
        const artifactIds = new Set(draft.mediaAssets?.map(asset => asset.assetId) ?? [])
        if (!draft.artifactBindingSha256 || boundIds.length < 1 || boundIds.some(assetId => !artifactIds.has(assetId))) {
          return { ready: false, reason: '图文消息至少需要一张精确绑定到当前微信目标且存在于 Artifact 的 Production Media 图片；正文远程图片不能替代该绑定。' }
        }
      }
      return { ready: true, reason: '' }
    }
    const ATTEMPT_STATE_LABELS = Object.freeze({ claimed: '已受理', 'destination-started': '目标提交中', completed: '已完成', skipped: '已跳过', 'not-committed': '未提交', 'reconciliation-required': '需要人工对账' })
    const ATTEMPT_FAILURE_LABELS = Object.freeze({ token: '获取微信令牌失败', 'body-upload': '正文图片处理失败', 'material-upload': '封面素材缺失或上传失败', 'draft-create': '创建微信草稿失败' })
    function attemptStateLabel(attempt) {
      const state = attempt.externalOutcome === 'unknown' ? '外部结果未知（允许重试）' : ATTEMPT_STATE_LABELS[attempt.state] ?? attempt.state
      if (!attempt.failureOperation && !attempt.reconciliationOperation) return state
      const operation = attempt.failureOperation ?? attempt.reconciliationOperation
      const detail = ATTEMPT_FAILURE_LABELS[operation] ?? operation
      return `${state} · ${detail}${Number.isInteger(attempt.failureCode) ? `（微信错误码 ${attempt.failureCode}）` : ''}${attempt.failureRequestId ? ` · 请求 ${attempt.failureRequestId}` : ''}`
    }
    function Empty({ children }) { return h('div', { className: 'pf-empty' }, children) }

    function createDashboardController() {
      let open = false
      let opener = null
      let closeGuard = null
      const listeners = new Set()
      const publish = value => {
        if (open === value) return
        open = value
        for (const listener of [...listeners]) listener()
      }
      return {
        getSnapshot: () => open,
        getOpener: () => opener,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        open(nextOpener) {
          opener = nextOpener?.focus ? nextOpener : document.activeElement
          publish(true)
        },
        close() {
          if (closeGuard && !closeGuard()) return false
          publish(false)
          return true
        },
        setCloseGuard(guard) {
          closeGuard = guard
          return () => { if (closeGuard === guard) closeGuard = null }
        },
      }
    }

    const PROMPT_SUGGESTIONS_EVENT = 'prismflow:prompt-suggestions-updated'
    function PromptSuggestionsDock({ input, inputActions }) {
      const [items, setItems] = React.useState([])
      const [copiedId, setCopiedId] = React.useState('')
      const dragRef = React.useRef({ active: false, captured: false, pointerId: null, startX: 0, startLeft: 0, suppressClick: false })
      React.useEffect(() => {
        let active = true
        const load = () => api('/prompt-suggestions').then(value => { if (active) setItems(value.suggestions?.items ?? []) }).catch(() => {})
        const refresh = event => {
          if (Array.isArray(event?.detail?.items)) setItems(event.detail.items)
          else void load()
        }
        window.addEventListener(PROMPT_SUGGESTIONS_EVENT, refresh)
        void load()
        return () => { active = false; window.removeEventListener(PROMPT_SUGGESTIONS_EVENT, refresh) }
      }, [])
      const enabled = items.filter(item => item.enabled && item.text)
      if (!enabled.length || !inputActions) return null
      const locked = input?.phase !== 'plain'
      const select = item => {
        if (dragRef.current.suppressClick) { dragRef.current.suppressClick = false; return }
        if (input?.draft && input.draft !== item.text && !window.confirm('当前输入框已有内容，是否使用候选文案替换？')) return
        inputActions.setDraft(item.text)
      }
      const copy = async (event, item) => {
        event.stopPropagation()
        if (dragRef.current.suppressClick) { dragRef.current.suppressClick = false; return }
        try {
          await window.navigator.clipboard.writeText(item.text)
          setCopiedId(item.id)
        } catch {
          setCopiedId('')
        }
      }
      const beginDrag = event => {
        if (event.button !== 0 || (event.pointerType && event.pointerType !== 'mouse')) return
        const target = event.currentTarget
        dragRef.current = { active: true, captured: false, pointerId: event.pointerId, startX: event.clientX, startLeft: target.scrollLeft, suppressClick: false }
      }
      const moveDrag = event => {
        const state = dragRef.current
        if (!state.active || state.pointerId !== event.pointerId) return
        const delta = event.clientX - state.startX
        if (Math.abs(delta) < 4 && !state.suppressClick) return
        state.suppressClick = true
        if (!state.captured) { event.currentTarget.setPointerCapture?.(event.pointerId); state.captured = true }
        event.currentTarget.classList?.add('pf-prompt-dragging')
        event.currentTarget.scrollLeft = state.startLeft - delta
        event.preventDefault()
      }
      const endDrag = event => {
        const state = dragRef.current
        if (!state.active || state.pointerId !== event.pointerId) return
        state.active = false
        event.currentTarget.classList?.remove('pf-prompt-dragging')
        if (state.captured && event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId)
        if (state.suppressClick) setTimeout(() => { if (!state.active) state.suppressClick = false }, 0)
      }
      return h('section', { className: 'pf-prompt-dock', 'aria-label': 'PrismFlow 候选输入文案' },
        h('div', { className: 'pf-prompt-dock-list', onPointerDown: beginDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag, onWheel: event => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          event.currentTarget.scrollLeft += event.deltaY
          event.preventDefault()
        } }, ...enabled.map(item => h('div', { className: 'pf-prompt-item', key: item.id },
          h('button', { type: 'button', className: 'pf-prompt-chip', draggable: false,
            title: item.text.replace(/\s+/gu, ' ').trim(), disabled: locked, onClick: () => select(item) }, item.text),
          h('button', { type: 'button', className: `pf-prompt-copy${copiedId === item.id ? ' pf-prompt-copy-copied' : ''}`, draggable: false,
            title: copiedId === item.id ? '已复制完整文案' : '复制完整文案', 'aria-label': copiedId === item.id ? `已复制候选文案：${item.id}` : `复制候选文案：${item.id}`,
            onClick: event => copy(event, item) }, copiedId === item.id ? '✓' : '复制')))))
    }

    function SidebarAction({ wide, controller }) {
      const actionRef = React.useRef(null)
      React.useEffect(() => {
        let footer = actionRef.current?.parentElement
        while (footer && typeof getComputedStyle === 'function' && getComputedStyle(footer).display === 'contents') footer = footer.parentElement
        if (!footer) return undefined
        footer.classList.add('pf-sidebar-footer-stack')
        return () => footer.classList.remove('pf-sidebar-footer-stack')
      }, [])
      return h('button', {
        ref: actionRef,
        type: 'button',
        className: `pf-sidebar-action ${wide ? 'pf-sidebar-action-wide' : 'pf-sidebar-action-rail'}`,
        onClick: event => controller.open(event?.currentTarget),
        title: '打开 PrismFlow 流光工作台',
        'aria-label': '打开 PrismFlow 流光工作台',
      },
      h('span', { className: 'pf-sidebar-icon', 'aria-hidden': true },
        h('svg', { width: wide ? 16 : 18, height: wide ? 16 : 18, viewBox: '0 0 16 16', fill: 'none' },
          h('path', { d: 'M8 1.5 14.5 8 8 14.5 1.5 8 8 1.5Z', stroke: 'currentColor', strokeWidth: '1.35', strokeLinejoin: 'round' }),
          h('path', { d: 'M8 4.6 11.4 8 8 11.4 4.6 8 8 4.6Z', fill: 'currentColor' }),
        )),
      wide ? h('span', { className: 'pf-sidebar-label' }, 'PrismFlow 流光') : null)
    }

    function DashboardOverlay({ controller }) {
      const open = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
      const panelRef = React.useRef(null)
      const initialFocusRef = React.useRef(null)
      React.useEffect(() => {
        if (!open) return undefined
        const opener = controller.getOpener()
        initialFocusRef.current?.focus()
        return () => opener?.focus?.()
      }, [open, controller])
      const handleDialogKeyDown = React.useCallback(event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          controller.close()
          return
        }
        if (event.key !== 'Tab') return
        const focusable = [...(panelRef.current?.querySelectorAll?.('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
          .filter(element => element.getAttribute?.('aria-hidden') !== 'true')
        if (!focusable.length) {
          event.preventDefault()
          initialFocusRef.current?.focus()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || !panelRef.current?.contains?.(active))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (active === last || !panelRef.current?.contains?.(active))) {
          event.preventDefault()
          first.focus()
        }
      }, [controller])
      if (!open) return null
      return h('div', { className: 'pf-overlay', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pf-dashboard-dialog-title', onKeyDown: handleDialogKeyDown },
        h('button', { type: 'button', className: 'pf-backdrop', onClick: controller.close, 'aria-label': '关闭 PrismFlow 工作台' }),
        h('div', { className: 'pf-panel', ref: panelRef },
          h('div', { className: 'pf-panel-head' }, h('strong', { id: 'pf-dashboard-dialog-title' }, 'PrismFlow 流光工作台'), h('button', { type: 'button', className: 'pf-close', ref: initialFocusRef, onClick: controller.close, 'aria-label': '关闭' }, '×')),
          h('div', { className: 'pf-panel-body' }, h(Dashboard, { controller })),
        ),
      )
    }

    const sourceAdapters = [
      { value: 'github-trending', label: 'GitHub Trending' },
      { value: 'follow', label: 'Follow API (Folo)' },
      { value: 'ai-search', label: 'AI 搜索' },
      { value: 'rss', label: 'RSS 订阅' },
    ]
    const categoryOptions = [
      { value: 'news', label: '新闻资讯 (news)' },
      { value: 'githubTrending', label: 'GitHub 热门 (githubTrending)' },
      { value: 'paper', label: '学术论文 (paper)' },
      { value: 'socialMedia', label: '社交媒体 (socialMedia)' },
      { value: 'rss', label: 'RSS 订阅 (rss)' },
    ]
    function defaultManagedSource(type = 'github-trending') {
      const category = type === 'github-trending' ? 'githubTrending' : type === 'ai-search' ? 'news' : type === 'follow' ? 'paper' : 'rss'
      const common = { type, id: '', name: '', category, enabled: true, limit: type === 'github-trending' ? '25' : type === 'ai-search' ? '10' : type === 'follow' ? '50' : '20' }
      if (type === 'github-trending') return { ...common, since: 'daily', spokenLanguageCode: '' }
      if (type === 'rss') return { ...common, url: '' }
      if (type === 'ai-search') return { ...common, keyword: '' }
      return { ...common, selectorType: 'list', listId: '', feedId: '', fetchDays: '3', fetchPages: '1', view: '0', pageDelayMs: '1500', detailDelayMs: '400', credentialSlotId: '' }
    }
    function optionalInteger(value) { return value === '' ? undefined : Number(value) }
    function integerInRange(value, minimum, maximum) {
      if (value === '') return false
      const parsed = Number(value)
      return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    }
    function sourceLimitMaximum(type) { return type === 'follow' ? 2000 : type === 'rss' ? 1000 : type === 'ai-search' ? 50 : 100 }
    function sourceEditorValid(source) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(source.id.trim()) || !source.name.trim() || !categoryOptions.some(item => item.value === source.category)) return false
      if (!integerInRange(source.limit, 1, sourceLimitMaximum(source.type))) return false
      if (source.type === 'rss') return !!source.url.trim()
      if (source.type === 'ai-search') return !!source.keyword.trim()
      if (source.type !== 'follow') return ['daily', 'weekly', 'monthly'].includes(source.since) && ['', 'en', 'zh'].includes(source.spokenLanguageCode)
      const selector = source.selectorType === 'feed' ? source.feedId : source.listId
      return !!selector.trim() && integerInRange(source.fetchDays, 1, 365) && integerInRange(source.fetchPages, 1, 20)
        && integerInRange(source.view, 0, 100) && integerInRange(source.pageDelayMs, 0, 60000) && integerInRange(source.detailDelayMs, 0, 60000)
    }

    function workflowStepTabId(stepId) { return `pf-workflow-step-tab-${stepId}` }

    const overwriteOptions = [{ value: 'never', label: '从不覆盖' }, { value: 'if-changed', label: '仅内容变化时覆盖' }]
    const articleTypeOptions = [{ value: 'news', label: '普通文章' }, { value: 'newspic', label: '图文消息' }]
    const digestPolicyOptions = [
      { value: 'omit', label: '不生成摘要' },
      { value: 'plain-text-excerpt', label: '使用正文纯文本摘录' },
      { value: 'artifact-or-omit', label: '优先使用 Artifact 摘要，否则省略' },
      { value: 'artifact-or-plain-text-excerpt', label: '优先使用 Artifact 摘要，否则使用正文纯文本摘录' },
    ]
    const publisherChannelDefinitions = [
      { kind: 'local-markdown', rowId: 'prismflow-publisher-local-markdown', label: '本地 Markdown 存储', group: 'artifact', nativeAddition: true, nativeNote: '将批准的 Markdown Artifact 原子写入部署固定的本地目录，适合归档和后续站点构建。', fields: [
        ['id', '目标 ID'], ['name', '显示名称'], ['root', 'Local 根目录'], ['artifactFileNamePattern', 'Artifact 文件名模式'], ['overwrite', '覆盖策略', overwriteOptions],
        ['maxBytes', '最大文件大小（Bytes）', 'number', { advanced: true, min: 1024, max: 2000000, help: '范围：1,024–2,000,000 Bytes' }],
      ] },
      { kind: 'github-markdown', rowId: 'prismflow-publisher-github-markdown', label: 'GitHub Archive', group: 'publish', fields: [
        ['id', '目标 ID'], ['name', '显示名称'], ['repository', '仓库 (Owner/Repo)'], ['branch', 'Branch'], ['pathPrefix', 'Path Prefix'], ['artifactFileNamePattern', 'Artifact 文件名模式'],
        ['overwrite', '覆盖策略', overwriteOptions], ['tokenCredential', 'Token 凭证引用'],
        ['artifactCommitMessage', 'Artifact Commit Message 模板', 'text', { advanced: true, maxLength: 200, help: '最多 200 字符；支持 {date}。' }],
        ['apiBaseUrl', 'API Base URL', 'text', { advanced: true, help: '仅允许无用户信息、查询或片段的 HTTPS URL。' }],
        ['maxBytes', '最大文件大小（Bytes）', 'number', { advanced: true, min: 1024, max: 1000000, help: '范围：1,024–1,000,000 Bytes' }],
      ] },
      { kind: 'r2-markdown', rowId: 'prismflow-publisher-r2-markdown', label: 'Cloudflare R2 存储', group: 'artifact', nativeAddition: true, nativeNote: '为批准内容和 Production Media 提供固定 Bucket、对象路径与公开地址；Chat 不能覆盖目标参数。', fields: [
        ['id', '目标 ID'], ['name', '显示名称'], ['accountId', 'R2 Account ID', 'text', { help: 'Cloudflare Dashboard 中的 32 位十六进制 Account ID；粘贴时会自动去除首尾空格。' }],
        ['bucket', 'Bucket Name', 'text', { help: '填写现有 R2 Bucket 名称，不是 S3 API Endpoint。' }],
        ['pathPrefix', 'Path Prefix', 'text', { help: 'Bucket 内相对目录，例如 daily；首尾斜杠会自动去除。' }], ['artifactFileNamePattern', 'Artifact 文件名模式'],
        ['overwrite', '覆盖策略', overwriteOptions], ['publicUrlPrefix', 'Public URL Prefix', 'text', { help: '公开 HTTPS 地址，例如 https://pub-xxx.r2.dev；不要填写需要鉴权的 S3 API Endpoint。' }], ['accessKeyIdCredential', 'Access Key ID 凭证引用'],
        ['secretAccessKeyCredential', 'Secret Access Key 凭证引用'],
        ['maxBytes', '最大文件大小（Bytes）', 'number', { advanced: true, min: 1024, max: 1000000, help: '范围：1,024–1,000,000 Bytes' }],
      ] },
      { kind: 'wechat-draft', rowId: 'prismflow-publisher-wechat-draft', label: '微信公众号', group: 'publish', fields: [
        ['id', '目标 ID'], ['name', '显示名称'], ['appId', 'App ID'], ['defaultAuthor', '文章作者'], ['appSecretCredential', 'App Secret 凭证引用'], ['articleType', '文章类型', articleTypeOptions],
        ['digestPolicy', '摘要策略', digestPolicyOptions, { help: 'Artifact 摘要存在时可优先使用；回退行为由所选策略明确决定。' }],
        ['needOpenComment', '开放评论', 'switch'], ['onlyFansCanComment', '仅粉丝可评论', 'switch'], ['defaultCoverAssetRef', '备用封面', 'text', { help: '与原程序一致：可填写无凭证、无 fragment 的 HTTPS 图片 URL；也可填写 Production Media Store 中预配置的资产别名。正文没有图片时使用。' }],
        ['allowInsecureHttp', '允许不安全 HTTP', 'switch', { advanced: true, help: '危险：启用后 App Secret、Access Token、文章和媒体会通过明文 HTTP 传输。仅用于必须使用 HTTP 的兼容网关。' }],
        ['apiOrigin', 'API Base URL', 'text', { advanced: true, help: '必须是无用户名、密码、查询参数或片段的 HTTP(S) Base URL。HTTP 地址还必须显式启用“允许不安全 HTTP”。' }],
        ['ffmpegPath', 'FFmpeg 覆盖路径', 'text', { advanced: true, help: '仅覆盖此微信目标；留空时使用“工具集 → 媒体处理与图片生成”中的全局路径与跨系统自动识别。' }],
        ['limits.titleChars', '标题上限（字符）', 'number', { advanced: true, min: 1, max: 32 }], ['limits.authorChars', '作者上限（字符）', 'number', { advanced: true, min: 1, max: 16 }],
        ['limits.digestChars', '摘要上限（字符）', 'number', { advanced: true, min: 1, max: 120 }], ['limits.contentChars', '正文上限（字符）', 'number', { advanced: true, min: 1000, max: 1000000 }],
        ['limits.contentBytes', '正文上限（Bytes）', 'number', { advanced: true, min: 2048, max: 1000000 }], ['limits.maxImages', '图片上限（张）', 'number', { advanced: true, min: 1, max: 20 }],
        ['limits.bodyImageBytes', '正文图片上限（Bytes）', 'number', { advanced: true, min: 1024, max: 999999 }], ['limits.permanentImageBytes', '永久图片上限（Bytes）', 'number', { advanced: true, min: 1024, max: 10485760 }],
        ['limits.maxPixels', '图片像素上限（Pixels）', 'number', { advanced: true, min: 1, max: 100000000 }], ['limits.maxSourceBytes', '源图片上限（Bytes）', 'number', { advanced: true, min: 1024, max: 33554432 }],
        ['limits.fetchTimeoutMs', '媒体抓取超时（ms）', 'number', { advanced: true, min: 100, max: 120000 }], ['limits.requestTimeoutMs', '请求超时（ms）', 'number', { advanced: true, min: 100, max: 120000 }],
        ['limits.concurrency', '并发数（个）', 'number', { advanced: true, min: 1, max: 8 }],
      ] },
    ]
    const publisherCompatibilityDefaults = {
      'local-markdown': { fileNamePattern: 'prismflow-{date}.md', title: 'PrismFlow Content', maxItems: 50, maxDescriptionChars: 1000 },
      'github-markdown': { fileNamePattern: '{date}.md', title: 'PrismFlow Content', maxItems: 50, maxDescriptionChars: 1000, commitMessage: 'chore: publish PrismFlow content {date}' },
      'r2-markdown': { fileNamePattern: '{date}.md', title: 'PrismFlow Content', maxItems: 50, maxDescriptionChars: 1000 },
      'wechat-draft': { tokenMode: 'stable' },
    }
    function nestedValue(value, path) { return path.split('.').reduce((current, key) => current?.[key], value) }
    function withNestedValue(value, path, next) {
      const keys = path.split('.'), clone = JSON.parse(JSON.stringify(value)); let current = clone
      for (const key of keys.slice(0, -1)) current = current[key] ??= {}
      current[keys.at(-1)] = next; return clone
    }
    function canonicalProfileValue(value) {
      if (Array.isArray(value)) return value.map(canonicalProfileValue)
      if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalProfileValue(value[key])]))
      return value
    }
    async function browserSha256(value) {
      const bytes = new TextEncoder().encode(JSON.stringify(canonicalProfileValue(value)))
      const digest = await window.crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    }
    function withoutFingerprint(value) { const { fingerprint: _fingerprint, ...body } = value; return body }
    function newPublisherCredentialRefs(kind) {
      const suffix = window.crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
      if (kind === 'github-markdown') return { tokenCredential: `PRISMFLOW_GITHUB_TOKEN_${suffix}` }
      if (kind === 'r2-markdown') return { accessKeyIdCredential: `PRISMFLOW_R2_ACCESS_KEY_ID_${suffix}`, secretAccessKeyCredential: `PRISMFLOW_R2_SECRET_ACCESS_KEY_${suffix}` }
      if (kind === 'wechat-draft') return { appSecretCredential: `PRISMFLOW_WECHAT_APP_SECRET_${suffix}` }
      return {}
    }
    function defaultPublisherDestination(kind, id) {
      const common = { id, name: id }
      if (kind === 'local-markdown') return { ...common, root: '', artifactFileNamePattern: 'prismflow-draft-{date}.md', overwrite: 'if-changed', maxBytes: 1000000 }
      if (kind === 'github-markdown') return { ...common, repository: '', branch: 'main', pathPrefix: 'daily', artifactFileNamePattern: 'draft-{date}.md', overwrite: 'if-changed', artifactCommitMessage: 'chore: publish approved PrismFlow draft {date}', apiBaseUrl: 'https://api.github.com', ...newPublisherCredentialRefs(kind), maxBytes: 900000 }
      if (kind === 'r2-markdown') return { ...common, accountId: '', bucket: '', pathPrefix: 'daily', artifactFileNamePattern: 'draft-{date}.md', overwrite: 'if-changed', publicUrlPrefix: '', ...newPublisherCredentialRefs(kind), maxBytes: 900000 }
      return { ...common, appId: '', ...newPublisherCredentialRefs(kind), apiOrigin: 'https://api.weixin.qq.com', allowInsecureHttp: 0, articleType: 'news', defaultAuthor: '', digestPolicy: 'artifact-or-omit', needOpenComment: 1, onlyFansCanComment: 0, defaultCoverAssetRef: 'https://source.hex2077.dev/logo/hex2077.ai.png', limits: { titleChars: 32, authorChars: 16, digestChars: 120, contentChars: 20000, contentBytes: 1000000, maxImages: 20, bodyImageBytes: 999999, permanentImageBytes: 10485760, maxPixels: 25000000, maxSourceBytes: 10485760, fetchTimeoutMs: 15000, requestTimeoutMs: 30000, concurrency: 1 } }
    }
    function browserProfileFail(message) { throw new Error(message) }
    function browserExact(value, allowed, field) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) browserProfileFail(`${field} 必须是对象`)
      const unknown = Object.keys(value).find(key => !allowed.includes(key))
      if (unknown) browserProfileFail(`${field} 包含未知字段 ${unknown}`)
      return value
    }
    function browserString(value, field, { required = true, max = 2048 } = {}) {
      if (value === undefined || value === null || typeof value !== 'string' || (required && value.length === 0)
        || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) browserProfileFail(`${field} 无效`)
      return value
    }
    function browserInteger(value, field, minimum, maximum, fallback) {
      const result = value === undefined ? fallback : value
      if (!Number.isInteger(result) || result < minimum || result > maximum) browserProfileFail(`${field} 必须是 ${minimum} 到 ${maximum} 的整数`)
      return result
    }
    function browserChoice(value, field, choices, fallback) {
      const result = value === undefined ? fallback : value
      if (!choices.includes(result)) browserProfileFail(`${field} 无效`)
      return result
    }
    function browserCredential(value, field, fallback) {
      const result = browserString(value ?? fallback, field, { max: 128 })
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(result) || /^(?:gh[pousr]_|github_pat_|sk-|AKIA|ASIA)/u.test(result)) browserProfileFail(`${field} 必须是有效 Credential Ref，不能填写真实凭证`)
      return result
    }
    function browserIdentity(value, field) {
      const id = browserString(value.id, `${field}.id`, { max: 128 })
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) browserProfileFail(`${field}.id 无效`)
      return { id, name: browserString(value.name, `${field}.name`, { max: 512 }) }
    }
    function browserArtifactPattern(value, field) {
      const pattern = browserString(value, field, { max: 256 })
      const rendered = pattern.replaceAll('{date}', '2000-01-01')
      if (pattern.replaceAll('{date}', '').includes('{') || pattern.replaceAll('{date}', '').includes('}')
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/u.test(rendered)
        || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(rendered)) browserProfileFail(`${field} 不是安全 Markdown basename`)
      return pattern
    }
    function browserCommitPattern(value, field) {
      const pattern = browserString(value, field, { max: 200 })
      const rendered = pattern.replaceAll('{date}', '2000-01-01')
      if (pattern.replaceAll('{date}', '').includes('{') || pattern.replaceAll('{date}', '').includes('}')
        || rendered.trim() !== rendered || rendered.length > 200) browserProfileFail(`${field} 无效`)
      return pattern
    }
    function browserCompatibility(value, defaults) {
      return Object.fromEntries(Object.entries(defaults).map(([field, fallback]) => {
        if (field === 'maxItems') return [field, browserInteger(value[field], field, 1, 100, fallback)]
        if (field === 'maxDescriptionChars') return [field, browserInteger(value[field], field, 1, 10000, fallback)]
        const result = field === 'commitMessage'
          ? browserCommitPattern(value[field] ?? fallback, field)
          : browserString(value[field] ?? fallback, field, { max: field === 'title' ? 512 : 256 })
        if (field === 'tokenMode' && result !== 'stable') browserProfileFail('tokenMode 无效')
        return [field, result]
      }))
    }
    function browserRelativePrefix(value, field) {
      if (value === '') return ''
      const result = browserString(value, field, { max: 500 })
      if (result.startsWith('/') || result.endsWith('/') || result.includes('\\')
        || result.split('/').some(segment => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/u.test(segment))) browserProfileFail(`${field} 不是规范相对路径`)
      return result
    }
    function browserAbsoluteRoot(value, field) {
      const root = browserString(value, field, { max: 4096 })
      if (/(?:^|[\\/])\.{1,2}(?:[\\/]|$)/u.test(root)) browserProfileFail(`${field} 必须是规范绝对路径`)
      if (root.startsWith('/')) return root.replace(/\/{2,}/gu, '/').replace(/^(.+)\/$/u, '$1')
      if (/^[A-Za-z]:[\\/]/u.test(root)) {
        const normalized = root.replaceAll('/', '\\').replace(/\\{2,}/gu, '\\')
        return normalized.length > 3 ? normalized.replace(/\\$/u, '') : normalized
      }
      if (/^\\\\[^\\/]+[\\/][^\\/]+/u.test(root)) return `\\\\${root.slice(2).replaceAll('/', '\\').replace(/\\{2,}/gu, '\\').replace(/\\$/u, '')}`
      browserProfileFail(`${field} 必须是规范绝对路径`)
    }
    function normalizePublisherConfigBrowser(kind, rawConfig) {
      const config = browserExact(rawConfig, ['destinations'], `${kind} config`)
      if (!Array.isArray(config.destinations) || config.destinations.length > 100) browserProfileFail(`${kind} destinations 无效`)
      const ids = new Set()
      const destinations = config.destinations.map((raw, index) => {
        const field = `${kind}.destinations[${index}]`
        let result
        if (kind === 'local-markdown') {
          const value = browserExact(raw, ['id', 'name', 'root', 'fileNamePattern', 'artifactFileNamePattern', 'title', 'overwrite', 'maxItems', 'maxDescriptionChars', 'maxBytes'], field)
          const root = browserAbsoluteRoot(value.root, `${field}.root`)
          result = { ...browserIdentity(value, field), root,
            artifactFileNamePattern: browserArtifactPattern(value.artifactFileNamePattern ?? 'prismflow-draft-{date}.md', `${field}.artifactFileNamePattern`),
            overwrite: browserChoice(value.overwrite, `${field}.overwrite`, ['never', 'if-changed'], 'if-changed'),
            maxBytes: browserInteger(value.maxBytes, `${field}.maxBytes`, 1024, 2000000, 1000000),
            ...browserCompatibility(value, publisherCompatibilityDefaults[kind]) }
        } else if (kind === 'github-markdown') {
          const value = browserExact(raw, ['id', 'name', 'repository', 'branch', 'pathPrefix', 'fileNamePattern', 'artifactFileNamePattern', 'title', 'overwrite', 'commitMessage', 'artifactCommitMessage', 'tokenCredential', 'apiBaseUrl', 'maxItems', 'maxDescriptionChars', 'maxBytes'], field)
          const repository = browserString(value.repository, `${field}.repository`, { max: 256 })
          const parts = repository.split('/')
          if (parts.length !== 2 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(parts[0])
            || !/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$/u.test(parts[1])) browserProfileFail(`${field}.repository 无效`)
          const branch = browserString(value.branch ?? 'main', `${field}.branch`, { max: 255 })
          if (branch === '@' || branch.startsWith('-') || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.')
            || branch.includes('..') || branch.includes('//') || branch.includes('@{') || branch.includes('\\') || /[\s~^:?*\[\]]/u.test(branch)
            || branch.split('/').some(segment => !segment || segment.startsWith('.') || segment.endsWith('.lock'))) browserProfileFail(`${field}.branch 无效`)
          const api = browserString(value.apiBaseUrl ?? 'https://api.github.com', `${field}.apiBaseUrl`)
          let parsedApiBase
          try { parsedApiBase = new URL(api) } catch { browserProfileFail(`${field}.apiBaseUrl 无效`) }
          if (parsedApiBase.protocol !== 'https:' || parsedApiBase.username || parsedApiBase.password || parsedApiBase.search || parsedApiBase.hash) browserProfileFail(`${field}.apiBaseUrl 无效`)
          const commit = browserCommitPattern(value.artifactCommitMessage ?? 'chore: publish approved PrismFlow draft {date}', `${field}.artifactCommitMessage`)
          result = { ...browserIdentity(value, field), repository, branch, pathPrefix: browserRelativePrefix(value.pathPrefix ?? 'daily', `${field}.pathPrefix`),
            artifactFileNamePattern: browserArtifactPattern(value.artifactFileNamePattern ?? 'draft-{date}.md', `${field}.artifactFileNamePattern`),
            overwrite: browserChoice(value.overwrite, `${field}.overwrite`, ['never', 'if-changed'], 'if-changed'), artifactCommitMessage: commit,
            apiBaseUrl: parsedApiBase.toString().replace(/\/$/u, ''), tokenCredential: browserCredential(value.tokenCredential, `${field}.tokenCredential`, 'GITHUB_TOKEN'),
            maxBytes: browserInteger(value.maxBytes, `${field}.maxBytes`, 1024, 1000000, 900000), ...browserCompatibility(value, publisherCompatibilityDefaults[kind]) }
        } else if (kind === 'r2-markdown') {
          const value = browserExact(raw, ['id', 'name', 'accountId', 'bucket', 'pathPrefix', 'fileNamePattern', 'artifactFileNamePattern', 'title', 'overwrite', 'accessKeyIdCredential', 'secretAccessKeyCredential', 'publicUrlPrefix', 'maxItems', 'maxDescriptionChars', 'maxBytes'], field)
          const accountId = browserString(value.accountId, `${field}.accountId`, { max: 64 }).trim().toLowerCase()
          if (!/^[a-f0-9]{32}$/u.test(accountId)) browserProfileFail(`${field}.accountId 必须是 32 位十六进制 Account ID`)
          const bucket = browserString(value.bucket, `${field}.bucket`, { max: 63 }).trim().toLowerCase()
          if (bucket.length < 3 || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(bucket) || bucket.includes('..') || bucket.includes('.-') || bucket.includes('-.') || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(bucket)) browserProfileFail(`${field}.bucket 不是有效的 R2 Bucket 名称`)
          const rawPublicValue = browserString(value.publicUrlPrefix ?? '', `${field}.publicUrlPrefix`, { required: false, max: 2048 }).trim()
          const publicValue = rawPublicValue !== '' && !/^[a-z][a-z0-9+.-]*:\/\//iu.test(rawPublicValue) ? `https://${rawPublicValue}` : rawPublicValue
          let publicUrlPrefix
          if (publicValue !== '') {
            try { const parsed = new URL(publicValue); if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(); publicUrlPrefix = parsed.toString().replace(/\/$/u, '') }
            catch { browserProfileFail(`${field}.publicUrlPrefix 必须是无凭证、查询参数或片段的公开 HTTPS 地址`) }
          }
          const rawPathPrefix = String(value.pathPrefix ?? 'daily').trim().replace(/^\/+|\/+$/gu, '')
          result = { ...browserIdentity(value, field), accountId, bucket, pathPrefix: browserRelativePrefix(rawPathPrefix, `${field}.pathPrefix`),
            artifactFileNamePattern: browserArtifactPattern(value.artifactFileNamePattern ?? 'draft-{date}.md', `${field}.artifactFileNamePattern`),
            overwrite: browserChoice(value.overwrite, `${field}.overwrite`, ['never', 'if-changed'], 'if-changed'), publicUrlPrefix,
            accessKeyIdCredential: browserCredential(value.accessKeyIdCredential, `${field}.accessKeyIdCredential`, 'R2_ACCESS_KEY_ID'),
            secretAccessKeyCredential: browserCredential(value.secretAccessKeyCredential, `${field}.secretAccessKeyCredential`, 'R2_SECRET_ACCESS_KEY'),
            maxBytes: browserInteger(value.maxBytes, `${field}.maxBytes`, 1024, 1000000, 900000), ...browserCompatibility(value, publisherCompatibilityDefaults[kind]) }
        } else if (kind === 'wechat-draft') {
          const value = browserExact(raw, ['id', 'name', 'appId', 'appSecretCredential', 'apiOrigin', 'allowInsecureHttp', 'tokenMode', 'articleType', 'defaultAuthor', 'digestPolicy', 'needOpenComment', 'onlyFansCanComment', 'defaultCoverAssetRef', 'ffmpegPath', 'limits'], field)
          const limitsRaw = browserExact(value.limits ?? {}, ['titleChars', 'authorChars', 'digestChars', 'contentChars', 'contentBytes', 'maxImages', 'bodyImageBytes', 'permanentImageBytes', 'maxPixels', 'maxSourceBytes', 'fetchTimeoutMs', 'requestTimeoutMs', 'concurrency'], `${field}.limits`)
          const ranges = { titleChars: [1,32,32], authorChars: [1,16,16], digestChars: [1,120,120], contentChars: [1000,1000000,20000], contentBytes: [2048,1000000,1000000], maxImages: [1,20,20], bodyImageBytes: [1024,999999,999999], permanentImageBytes: [1024,10485760,10485760], maxPixels: [1,100000000,25000000], maxSourceBytes: [1024,33554432,10485760], fetchTimeoutMs: [100,120000,15000], requestTimeoutMs: [100,120000,30000], concurrency: [1,8,1] }
          const limits = Object.fromEntries(Object.entries(ranges).map(([key, range]) => [key, browserInteger(limitsRaw[key], `${field}.limits.${key}`, ...range)]))
          const appId = browserString(value.appId, `${field}.appId`, { max: 128 })
          if (!/^wx[A-Za-z0-9]{1,126}$/u.test(appId)) browserProfileFail(`${field}.appId 无效`)
          const origin = browserString(value.apiOrigin ?? 'https://api.weixin.qq.com', `${field}.apiOrigin`, { max: 2048 })
          const allowInsecureHttp = browserInteger(value.allowInsecureHttp, `${field}.allowInsecureHttp`, 0, 1, 0)
          let parsedOrigin
          try { parsedOrigin = new URL(origin) } catch { browserProfileFail(`${field}.apiOrigin 无效`) }
          const allowedProtocol = parsedOrigin.protocol === 'https:' || (parsedOrigin.protocol === 'http:' && allowInsecureHttp === 1)
          if (!allowedProtocol || parsedOrigin.username || parsedOrigin.password || parsedOrigin.search || parsedOrigin.hash) browserProfileFail(`${field}.apiOrigin 必须是无凭证、查询参数或片段的 HTTP(S) Base URL；HTTP 必须启用“允许不安全 HTTP”`)
          const apiBaseUrl = `${parsedOrigin.origin}${parsedOrigin.pathname.replace(/\/+$/u, '')}`
          const ffmpegPath = value.ffmpegPath === undefined || value.ffmpegPath === '' ? undefined : browserString(value.ffmpegPath, `${field}.ffmpegPath`, { max: 1024 })
          result = { ...browserIdentity(value, field), appId, appSecretCredential: browserCredential(value.appSecretCredential, `${field}.appSecretCredential`),
            apiOrigin: apiBaseUrl, ...(allowInsecureHttp === 1 ? { allowInsecureHttp: 1 } : {}), articleType: browserChoice(value.articleType, `${field}.articleType`, ['news', 'newspic']),
            defaultAuthor: browserString(value.defaultAuthor ?? '', `${field}.defaultAuthor`, { required: false, max: limits.authorChars }),
            digestPolicy: browserChoice(value.digestPolicy, `${field}.digestPolicy`, ['omit', 'plain-text-excerpt', 'artifact-or-omit', 'artifact-or-plain-text-excerpt'], 'artifact-or-omit'),
            needOpenComment: browserInteger(value.needOpenComment, `${field}.needOpenComment`, 0, 1, 1), onlyFansCanComment: browserInteger(value.onlyFansCanComment, `${field}.onlyFansCanComment`, 0, 1, 0),
            defaultCoverAssetRef: browserString(value.defaultCoverAssetRef ?? '', `${field}.defaultCoverAssetRef`, { required: false, max: 256 }),
            ...(ffmpegPath === undefined ? {} : { ffmpegPath }), limits,
            ...browserCompatibility(value, publisherCompatibilityDefaults[kind]) }
        } else browserProfileFail(`不支持发布渠道 ${kind}`)
        if (ids.has(result.id)) browserProfileFail(`${kind} destination ID 重复`)
        ids.add(result.id)
        return result
      })
      return { destinations }
    }
    function publisherRuntimeApplied(imported, channel) {
      if (!imported) return false
      if (imported.disabled) return channel?.active === false
      return channel?.active === true && imported.configRevision === channel?.configRevision
    }
    function visualPublisherErrors(rows) {
      const errors = []
      for (const row of rows) {
        const definition = publisherChannelDefinitions.find(item => item.rowId === row.rowId)
        try {
          if (!definition || row.channelKind !== definition.kind) browserProfileFail('Profile 文档包含不支持的发布行')
          if (row.migrationRequired === true) browserProfileFail(`${definition.label} 包含旧版凭证引用；必须“替换目标”并填写有效 Credential Ref`)
          const normalized = normalizePublisherConfigBrowser(row.channelKind, row.config)
          if (normalized.destinations.some(destination => Object.entries(destination).some(([key, credential]) => /Credential$/u.test(key) && credential === 'MIGRATION_REQUIRED'))) {
            browserProfileFail(`${definition.label} 的替换目标必须填写有效 Credential Ref`)
          }
        } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
      }
      return [...new Set(errors)]
    }

    function Dashboard({ controller }) {
      const [tab, setTab] = React.useState('overview')
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [publishers, setPublishers] = React.useState([])
      const [drafts, setDrafts] = React.useState([])
      const [receipts, setReceipts] = React.useState([])
      const [sourceSettings, setSourceSettings] = React.useState([])
      const [credentialSlots, setCredentialSlots] = React.useState([])
      const [adapterStates, setAdapterStates] = React.useState(sourceAdapters.map(adapter => ({ type: adapter.value, enabled: true })))
      const [sourceEditor, setSourceEditor] = React.useState(defaultManagedSource())
      const [editingSourceId, setEditingSourceId] = React.useState('')
      const [credentialValues, setCredentialValues] = React.useState({})
      const [draftEditors, setDraftEditors] = React.useState({})
      const [expandedDrafts, setExpandedDrafts] = React.useState({})
      const [workflowCatalog, setWorkflowCatalog] = React.useState([])
      const [workflowEditor, setWorkflowEditor] = React.useState(null)
      const [workflowBaseline, setWorkflowBaseline] = React.useState(null)
      const [workflowHistory, setWorkflowHistory] = React.useState([])
      const [historicalWorkflow, setHistoricalWorkflow] = React.useState(null)
      const [productionRequests, setProductionRequests] = React.useState([])
      const [activeWorkflowStepId, setActiveWorkflowStepId] = React.useState('')
      const [workflowHistoryExpanded, setWorkflowHistoryExpanded] = React.useState(false)
      const [workflowStepAnnouncement, setWorkflowStepAnnouncement] = React.useState('')
      const [publisherChannels, setPublisherChannels] = React.useState([])
      const [publisherProfileDocument, setPublisherProfileDocument] = React.useState(null)
      const [publisherProfileRows, setPublisherProfileRows] = React.useState([])
      const [publisherProfileBaseline, setPublisherProfileBaseline] = React.useState([])
      const [publisherMaintenance, setPublisherMaintenance] = React.useState({ entered: false, drained: false, timedOut: false, activeAttempts: 0, restartRequired: false })
      const [publisherPendingOperation, setPublisherPendingOperation] = React.useState(null)
      const [workflowDeleteDialog, setWorkflowDeleteDialog] = React.useState(null)
      const [publisherCredentialSlots, setPublisherCredentialSlots] = React.useState([])
      const [publisherCredentialValues, setPublisherCredentialValues] = React.useState({})
      const [selectedPublisherRowId, setSelectedPublisherRowId] = React.useState('prismflow-publisher-wechat-draft')
      const [selectedPublisherDestinationId, setSelectedPublisherDestinationId] = React.useState('')
      const [publishingTargetId, setPublishingTargetId] = React.useState('')
      const [publicationFeedback, setPublicationFeedback] = React.useState(null)
      const [prismToolset, setPrismToolset] = React.useState(null)
      const [prismPlugins, setPrismPlugins] = React.useState([])
      const [prismSkills, setPrismSkills] = React.useState([])
      const [prismSkillEditor, setPrismSkillEditor] = React.useState(null)
      const [prismSkillHistory, setPrismSkillHistory] = React.useState([])
      const [rssOutputs, setRssOutputs] = React.useState([])
      const [rssOutputDetails, setRssOutputDetails] = React.useState({})
      const [imageGenerationSettings, setImageGenerationSettings] = React.useState(null)
      const [imageGenerationCredential, setImageGenerationCredential] = React.useState(null)
      const [imageGenerationCredentialValue, setImageGenerationCredentialValue] = React.useState('')
      const [presentationMediaPreview, setPresentationMediaPreview] = React.useState(null)
      const [draftQuery, setDraftQuery] = React.useState({ status: '', query: '', page: 1, pageSize: 10 })
      const [draftPage, setDraftPage] = React.useState({ total: 0, statusCounts: {} })
      const [promptSuggestions, setPromptSuggestions] = React.useState(null)
      const [contentQuery, setContentQuery] = React.useState({ search: '', category: '', aiProcessed: '', sortBy: 'publishedAt', sortOrder: 'desc', page: 1, pageSize: 20 })
      const [contentPage, setContentPage] = React.useState({ records: [], total: 0, categories: [] })
      const [ffmpegStatus, setFfmpegStatus] = React.useState(null)
      const publisherApplyRequest = React.useRef(null)
      const publisherCompletedOperation = React.useRef(null)
      const editingSourceRevision = React.useRef('')
      const activeController = React.useRef(null)
      const pendingWorkflowStepFocus = React.useRef(null)
      const workflowDeleteCancelRef = React.useRef(null)
      const workflowDeleteOpenerRef = React.useRef(null)
      const workflowSelectorRef = React.useRef(null)

      React.useEffect(() => {
        const pending = pendingWorkflowStepFocus.current
        const steps = (historicalWorkflow ?? workflowEditor)?.steps ?? []
        if (!pending) return undefined
        if (tab !== 'workflows' || pending.stepId !== activeWorkflowStepId || !steps.some(step => step.id === pending.stepId)) {
          pendingWorkflowStepFocus.current = null
          return undefined
        }
        const frame = window.requestAnimationFrame(() => {
          if (pendingWorkflowStepFocus.current !== pending) return
          pendingWorkflowStepFocus.current = null
          document.getElementById(workflowStepTabId(pending.stepId))?.focus()
          setWorkflowStepAnnouncement(pending.announcement)
        })
        return () => window.cancelAnimationFrame(frame)
      }, [tab, workflowEditor, historicalWorkflow, activeWorkflowStepId])

      React.useEffect(() => {
        if (workflowDeleteDialog) window.requestAnimationFrame(() => workflowDeleteCancelRef.current?.focus())
      }, [!!workflowDeleteDialog])
      React.useEffect(() => () => {
        activeController.current?.abort()
        activeController.current = null
      }, [])
      React.useEffect(() => {
        const controller = new AbortController()
        void api('/publisher-profile/pending-operation', { signal: controller.signal })
          .then(value => { if (value.operation?.status === 'pending') setPublisherPendingOperation(value.operation) })
          .catch(() => {})
        return () => controller.abort()
      }, [])
      React.useEffect(() => {
        activeController.current?.abort()
        activeController.current = null
        setBusy('')
      }, [tab])

      const run = React.useCallback(async (key, operation, success) => {
        activeController.current?.abort()
        const controller = new AbortController()
        activeController.current = controller
        setBusy(key); setNotice(null)
        try {
          const value = await operation(controller.signal)
          const successText = typeof success === 'function' ? success(value) : success
          if (!controller.signal.aborted && successText) setNotice({ type: 'ok', text: successText })
          return value
        } catch (error) {
          if (!controller.signal.aborted) {
            if (error instanceof ApiError && error.value?.restartRequired === true) {
              setPublisherMaintenance(current => ({ ...current, entered: error.value.maintenance === true || current.entered,
                restartRequired: true }))
            }
            setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
          }
          return undefined
        } finally {
          if (activeController.current === controller) {
            activeController.current = null
            setBusy('')
          }
        }
      }, [])

      const refreshOverview = React.useCallback(async () => {
        const value = await run('overview', signal => api('/status', { signal }), '状态已刷新')
        if (value) setStatus(value)
      }, [run])
      const loadSourceSettings = React.useCallback(async () => {
        const value = await run('source-settings', signal => api('/source-settings', { signal }), '数据源配置已刷新')
        if (value) { setSourceSettings(value.sources); setCredentialSlots(value.credentialSlots); setAdapterStates(value.adapters) }
      }, [run])
      const loadReview = React.useCallback(async ({ resetEditors = false, queryState = draftQuery } = {}) => {
        const value = await run('review', async signal => {
          const [draftRows, publisherRows, rssRows] = await Promise.all([
            api('/production/drafts', { body: { status: queryState.status || undefined, query: queryState.query.trim() || undefined, offset: (queryState.page - 1) * queryState.pageSize, limit: queryState.pageSize }, signal }),
            api('/publishers', { signal }),
            status?.services.rssOutputs ? api('/production/rss-outputs', { body: { limit: 100 }, signal }) : Promise.resolve({ records: [] }),
          ])
          return { draftRows, publisherRows, rssRows }
        }, '草稿、RSS 生成内容与发布目标已刷新')
        if (value) {
          setDrafts(value.draftRows.records); setDraftPage({ total: value.draftRows.total ?? value.draftRows.records.length, statusCounts: value.draftRows.statusCounts ?? {} }); setPublishers(value.publisherRows); setRssOutputs(value.rssRows.records)
          setRssOutputDetails(current => Object.fromEntries(Object.entries(current).filter(([outputId]) => value.rssRows.records.some(record => record.outputId === outputId))))
          const serverEditors = Object.fromEntries(value.draftRows.records.map(draft => [draft.draftId, { title: draft.title, markdown: draft.markdown }]))
          setDraftEditors(current => resetEditors ? serverEditors : { ...serverEditors, ...current })
        }
      }, [run, status?.services.rssOutputs, draftQuery])
      const loadContent = React.useCallback(async queryState => {
        const query = queryState ?? contentQuery
        const params = new URLSearchParams({
          limit: String(query.pageSize), offset: String((query.page - 1) * query.pageSize), sortBy: query.sortBy, sortOrder: query.sortOrder,
        })
        if (query.search.trim()) params.set('search', query.search.trim())
        if (query.category) params.set('category', query.category)
        if (query.aiProcessed) params.set('aiProcessed', query.aiProcessed)
        const value = await run('content', signal => api(`/content?${params.toString()}`, { signal }), '已抓取数据已刷新')
        if (value) setContentPage({ records: value.records ?? [], total: value.total ?? 0, categories: value.categories ?? [] })
      }, [run, contentQuery])
      const refreshReceipts = React.useCallback(async () => {
        const value = await run('receipts', signal => api('/receipts/query', { body: { limit: 50 }, signal }), '发布记录已刷新')
        if (value) setReceipts(value.records)
      }, [run])
      const readPublisherProfileState = React.useCallback(async signal => {
        const [profile, runtime, reconciliation] = await Promise.all([
          api('/publisher-profile/read', { body: {}, signal }),
          api('/publisher-channels', { signal }),
          api('/publisher-profile/pending-operation', { signal }),
        ])
        return { document: profile.document, channels: runtime.channels, operation: reconciliation.operation, credentialSlots: profile.credentialSlots ?? [] }
      }, [])
      const loadPublisherChannels = React.useCallback(async () => {
        const value = await run('publisher-profile', readPublisherProfileState, '发布配置与运行状态已刷新')
        if (value) {
          const rows = JSON.parse(JSON.stringify(value.document.rows))
          setPublisherChannels(value.channels)
          setPublisherCredentialSlots(value.credentialSlots)
          setPublisherProfileDocument(value.document)
          setPublisherProfileRows(rows)
          setPublisherProfileBaseline(JSON.parse(JSON.stringify(rows)))
          setPublisherPendingOperation(value.operation?.status === 'pending' ? value.operation : null)
          setPublisherMaintenance({ entered: value.operation?.status === 'pending', drained: false, timedOut: false, activeAttempts: 0,
            restartRequired: value.operation?.restartRequired === true })
          if (!value.operation || value.operation.status === 'completed') publisherApplyRequest.current = null
          publisherCompletedOperation.current = null
        }
      }, [run, readPublisherProfileState])
      const loadWorkflows = React.useCallback(async preferredId => {
        const value = await run('workflows', async signal => {
          const list = await api('/generator-workflows', { signal })
          const selected = list.records.find(item => item.generatorId === preferredId) ?? list.records[0] ?? null
          const [history, requests] = await Promise.all([
            selected?.kind === 'workflow-v1' ? api(`/generator-workflows/history?generatorId=${encodeURIComponent(selected.generatorId)}&limit=50`, { signal }) : Promise.resolve({ records: [] }),
            status?.services.production ? api('/production/requests', { body: { limit: 50 }, signal }) : Promise.resolve({ records: [] }),
          ])
          return { records: list.records, selected, history: history.records, requests: requests.records }
        }, '工作流生成器已刷新')
        if (value) {
          setWorkflowCatalog(value.records); setWorkflowEditor(value.selected ? JSON.parse(JSON.stringify(value.selected)) : null); setWorkflowBaseline(value.selected ? JSON.parse(JSON.stringify(value.selected)) : null)
          setWorkflowHistory(value.history); setHistoricalWorkflow(null); setProductionRequests(value.requests); setWorkflowHistoryExpanded(false)
          setActiveWorkflowStepId(current => value.selected?.steps.some(step => step.id === current) ? current : value.selected?.steps[0]?.id || '')
        }
      }, [run, status?.services.production])
      React.useEffect(() => {
        if (status === null) {
          void refreshOverview()
          return
        }
        if (tab === 'source-settings' && status?.services.sourceSettings) void loadSourceSettings()
        else if (tab === 'content' && status?.services.contentStore) void loadContent(contentQuery)
        else if (tab === 'review' && status?.services.production) void loadReview()
        else if (tab === 'receipts' && status?.services.receipts) void refreshReceipts()
        else if (tab === 'workflows' && status?.services.generatorWorkflows) void loadWorkflows()
        else if (tab === 'publisher-profile' && status?.services.publishers) void loadPublisherChannels()
        else if (tab === 'toolsets' && status?.services.toolsets) void loadPrismToolset()
      }, [tab, status?.services.sourceSettings, status?.services.contentStore, status?.services.production, status?.services.receipts, status?.services.generatorWorkflows, status?.services.publishers, status?.services.toolsets, status?.services.imageGenerationSettings])

      const tabs = [
        ['overview', '总览'], ['toolsets', '工具集'], ['source-settings', '数据源配置'], ['content', '已抓取数据'], ['publisher-profile', '发布与存储'], ['workflows', '工作流生成器'], ['review', '草稿审核与发布'], ['receipts', '发布审计'],
      ]
      const serviceCards = status ? [
        ['数据源配置', status.services.sourceSettings, status.services.sourceSettings ? `${status.counts.sourceSettings} 项` : '未启用'],
        ['Chat 数据工具', status.services.sources && status.services.contentStore, status.services.sources && status.services.contentStore ? `${status.counts.sources} 个数据源 · ${status.counts.contents ?? 0} 条数据` : '未启用'],
        ['PrismFlow 工具集', status.services.toolsets, status.services.toolsets ? '工具与 Skill 可配置' : '未启用'],
        ['图片生成配置', status.services.imageGenerationSettings, status.services.imageGenerationSettings ? '接口、模型与凭证可配置' : '未启用'],
        ['工作流生成器', status.services.generatorWorkflows, status.services.generatorWorkflows ? `${status.counts.generatorWorkflows} 个定义（含待迁移旧版）` : '未启用'],
        ['草稿生产', status.services.production, status.services.production ? `${status.counts.generators} 个生成器` : '未启用'],
        ['RSS 生成内容', status.services.rssOutputs, status.services.rssOutputs ? `${status.counts.rssOutputs} 份本地记录` : '未启用'],
        ['发布目标', status.services.publishers, status.counts.publishers],
        ['发布审计', status.services.receipts, status.services.receipts ? '已启用' : '未启用'],
      ] : []

      async function loadPrismToolset() {
        const value = await run('toolsets:load', async signal => {
          const [toolsets, image, prompts] = await Promise.all([
            api('/toolsets', { signal }),
            status?.services.imageGenerationSettings ? api('/image-generation/settings', { signal }) : Promise.resolve(null),
            api('/prompt-suggestions', { signal }),
          ])
          return { toolsets, image, prompts }
        })
        if (value) {
          setPrismToolset(value.toolsets.toolset)
          setPrismPlugins(value.toolsets.plugins || [])
          setPrismSkills(value.toolsets.skills || [])
          setPromptSuggestions(value.prompts?.suggestions ?? null)
          if (value.image) {
            setImageGenerationSettings({ ...value.image.settings, avifQuality: String(value.image.settings.avifQuality), avifEffort: String(value.image.settings.avifEffort) })
            setImageGenerationCredential(value.image.credential); setImageGenerationCredentialValue(''); setFfmpegStatus(value.image.ffmpeg ?? null)
          }
        }
      }
      function editImageGenerationSetting(field, value) { setImageGenerationSettings(current => ({ ...current, [field]: value })) }
      async function saveImageGenerationSettings() {
        const current = imageGenerationSettings
        if (/^http:\/\//iu.test(current.imageApiUrl.trim()) && !window.confirm('当前图片生成接口使用明文 HTTP。API Key、提示词和生成结果可能被网络中的第三方读取或篡改。确认仍要保存？')) return
        const value = await run('image-generation:save', signal => api('/image-generation/settings', { body: {
          settings: { imageApiUrl: current.imageApiUrl.trim(), imageApiProtocol: current.imageApiProtocol, imageModel: current.imageModel.trim(), imageSize: current.imageSize.trim(), avifQuality: Number(current.avifQuality), avifEffort: Number(current.avifEffort), ffmpegPath: current.ffmpegPath.trim() },
          expected: { version: current.version, sha256: current.sha256 },
        }, signal }), '图片生成配置已保存，下一次 Chat 调用立即使用。')
        if (value) { setImageGenerationSettings({ ...value.settings, avifQuality: String(value.settings.avifQuality), avifEffort: String(value.settings.avifEffort) }); setImageGenerationCredential(value.credential); setFfmpegStatus(value.ffmpeg ?? null) }
      }
      async function saveImageGenerationCredential() {
        if (!imageGenerationCredentialValue) { setNotice({ type: 'error', text: '请输入非空 API Key。' }); return }
        const value = await run('image-generation:credential:set', signal => api('/image-generation/credential/set', { body: { value: imageGenerationCredentialValue }, signal }), imageGenerationCredential?.configured ? '图片 API Key 已安全轮换。' : '图片 API Key 已安全保存。')
        if (value) { setImageGenerationCredential(value.credential); setImageGenerationCredentialValue('') }
      }
      async function removeImageGenerationCredential() {
        if (!window.confirm('移除图片生成 API Key？移除后 prismflow_image_generation 将无法调用，直到重新配置。')) return
        const value = await run('image-generation:credential:unset', signal => api('/image-generation/credential/unset', { body: {}, signal }), '图片 API Key 已移除。')
        if (value) { setImageGenerationCredential(value.credential); setImageGenerationCredentialValue('') }
      }
      function togglePlugin(plugin) { setPrismToolset(current => {
        const enabled = current.enabledPlugins.includes(plugin.pluginId)
        return { ...current, mode: 'custom', enabledPlugins: enabled ? current.enabledPlugins.filter(id => id !== plugin.pluginId) : [...current.enabledPlugins, plugin.pluginId],
          enabledTools: enabled ? current.enabledTools.filter(tool => !plugin.tools.includes(tool)) : [...new Set([...current.enabledTools, ...plugin.tools])] }
      }) }
      function togglePluginTool(plugin, name) { setPrismToolset(current => {
        if (!current.enabledPlugins.includes(plugin.pluginId)) return current
        return { ...current, mode: 'custom', enabledTools: current.enabledTools.includes(name) ? current.enabledTools.filter(item => item !== name) : [...current.enabledTools, name] }
      }) }
      function toggleSkill(name) { setPrismToolset(current => ({ ...current, enabledSkills: current.enabledSkills.includes(name) ? current.enabledSkills.filter(item => item !== name) : [...current.enabledSkills, name] })) }
      async function savePrismToolset() {
        const value = await run('toolsets:save', signal => api('/toolsets', { method: 'POST', body: { mode: prismToolset.mode, enabledPlugins: prismToolset.enabledPlugins, enabledTools: prismToolset.enabledTools, enabledSkills: prismToolset.enabledSkills, expected: { version: prismToolset.version, sha256: prismToolset.sha256 } }, signal }), '插件与 Skill 配置已保存；Skill 选择立即生效，插件与工具变更在重启 DSH 后完整生效。')
        if (value) { setPrismToolset(value.toolset); await loadPrismToolset() }
      }
      function updatePromptSuggestion(id, patch) { setPromptSuggestions(current => ({ ...current, items: current.items.map(item => item.id === id ? { ...item, ...patch } : item) })) }
      function addPromptSuggestion() { setPromptSuggestions(current => ({ ...current, items: [...current.items, { id: `prompt-${window.crypto.randomUUID().toLowerCase()}`, text: '', enabled: true }] })) }
      function deletePromptSuggestion(id) { setPromptSuggestions(current => ({ ...current, items: current.items.filter(item => item.id !== id) })) }
      function movePromptSuggestion(index, offset) { setPromptSuggestions(current => {
        const target = index + offset
        if (target < 0 || target >= current.items.length) return current
        const items = [...current.items]; const [item] = items.splice(index, 1); items.splice(target, 0, item)
        return { ...current, items }
      }) }
      async function savePromptSuggestions() {
        if (!promptSuggestions.items.length || promptSuggestions.items.some(item => !item.text.trim())) { setNotice({ type: 'error', text: '候选文案不能为空。' }); return }
        const value = await run('prompt-suggestions:save', signal => api('/prompt-suggestions', { method: 'POST', body: {
          items: promptSuggestions.items.map(item => ({ id: item.id, text: item.text, enabled: item.enabled })),
          expected: { version: promptSuggestions.version, sha256: promptSuggestions.sha256 },
        }, signal }), 'Chat 候选输入文案已保存并立即刷新。')
        if (value) {
          setPromptSuggestions(value.suggestions)
          window.dispatchEvent(new window.CustomEvent(PROMPT_SUGGESTIONS_EVENT, { detail: { items: value.suggestions.items } }))
        }
      }
      async function editPrismSkill(skillId) {
        const value = await run('skill:load', signal => Promise.all([api(`/toolsets/skill?skillId=${encodeURIComponent(skillId)}`, { signal }), api(`/toolsets/skill/history?skillId=${encodeURIComponent(skillId)}`, { signal })]))
        if (!value) return
        const [detail, history] = value
        setPrismSkillEditor({ ...detail.skill, isNew: false }); setPrismSkillHistory(history.records || [])
      }
      function newPrismSkill() { setPrismSkillEditor({ skillId: 'prismflow-', name: '', description: '', whenToUse: '', content: '# ', enabled: true, isNew: true }); setPrismSkillHistory([]) }
      async function exportPrismFlowData() {
        const password = window.prompt('请输入备份加密密码（至少 12 个字符）。此密码不会保存，导入时必须使用同一密码。', '')
        if (password === null) return
        const confirmation = window.prompt('请再次输入备份密码。', '')
        if (password !== confirmation) { setNotice({ type: 'error', text: '两次输入的备份密码不一致。' }); return }
        if (password.length < 12 || password.length > 256) { setNotice({ type: 'error', text: '备份密码必须为 12 到 256 个字符。' }); return }
        const value = await run('data-backup:export', async signal => {
          const response = await fetch(`${API_PREFIX}/configuration-backup/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }), signal })
          if (!response.ok) {
            let value; try { value = await response.json() } catch { value = {} }
            throw new ApiError(response.status, value.error || `Request failed (${response.status})`, value)
          }
          const workflowHistoryCount = Number(response.headers?.get?.('x-prismflow-workflow-history-count') ?? '0')
          const workflowIdCount = Number(response.headers?.get?.('x-prismflow-workflow-id-count') ?? '0')
          const deletedWorkflowIdCount = Number(response.headers?.get?.('x-prismflow-deleted-workflow-id-count') ?? '0')
          const blob = await response.blob()
          const date = new Date().toISOString().slice(0, 10)
          downloadBlob(blob, `prismflow-configuration-backup-${date}.pfbackup`)
          return { size: blob.size, workflowHistoryCount, workflowIdCount, deletedWorkflowIdCount }
        }, '加密配置备份已导出。')
        if (value) setNotice({ type: 'success', text: `加密配置备份已导出：包含 ${value.workflowIdCount} 个当前工作流及其完整历史（共 ${value.workflowHistoryCount} 条记录）${value.deletedWorkflowIdCount ? `，另保留 ${value.deletedWorkflowIdCount} 个已删除工作流的 tombstone 审计历史` : ''}；同时包含数据源、发布/存储目标和 Credential，不包含已抓取内容。` })
      }
      function importPrismFlowData() {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.pfbackup,application/vnd.prismflow.configuration-backup+json,application/json'
        input.onchange = async () => {
          const file = input.files?.[0]; if (!file) return
          if (file.size > 16 * 1024 * 1024) { setNotice({ type: 'error', text: '加密配置备份超过 16 MiB 请求上限。' }); return }
          let documentValue; try { documentValue = JSON.parse(await file.text()) } catch { throw new Error('备份文件不是有效的加密 PrismFlow 配置文件') }
          const password = window.prompt('请输入该备份文件的解密密码。', '')
          if (password === null) return
          if (!window.confirm('配置恢复会替换数据源、发布与存储目标、工作流、图片设置、工具集、候选文案和 Skill 配置，并恢复备份中的 Cookie、API Key 等 PrismFlow Credential；不会导入或删除已抓取内容、草稿、媒体和发布记录。完成后必须立即重启 DSH。继续吗？')) return
          const value = await run('data-backup:import', signal => api('/configuration-backup/import', { method: 'POST', body: { password, document: documentValue }, signal }), '配置和 Credential 已恢复；已抓取内容保持不变。请立即重启 DSH，并新建 Chat。')
          if (value) {
            const mappedPaths = value.publisherPathMappings?.length ? ` 已将 ${value.publisherPathMappings.length} 个外平台本地路径安全映射到当前 DSH Home。` : ''
            setNotice({ type: 'success', text: `已恢复 ${value.recordCount} 条配置记录，其中包含 ${value.workflowIdCount} 个当前工作流及其完整历史（共 ${value.workflowHistoryCount} 条记录）${value.deletedWorkflowIdCount ? `，另保留 ${value.deletedWorkflowIdCount} 个已删除工作流的 tombstone 审计历史` : ''}；另含 ${value.publisherDestinationCount} 个发布/存储目标、${value.credentialSlotCount} 个数据源 Credential 槽位和 ${value.credentialCount} 个 Credential。${mappedPaths}必须立即重启 DSH。` })
          }
        }
        input.click()
      }
      function importPersonalPluginZip() {
        if (!window.confirm('个人插件包含可执行 JavaScript，将获得与 DSH 进程相同的本机权限。仅上传你已审查并完全信任的代码。是否继续？')) return
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.zip,application/zip'
        input.onchange = async () => {
          const file = input.files?.[0]; if (!file) return
          if (file.size > 600 * 1024) { setNotice({ type: 'error', text: '个人插件 ZIP 超过 600 KiB 请求上限。' }); return }
          const value = await run('plugin:zip', signal => api('/toolsets/plugin/import-zip', { method: 'POST', rawBody: file, contentType: 'application/zip', signal }), '个人插件已安装；重启 DSH 后“全部启用”模式会自动启用，其他模式需手动启用并再次重启。')
          if (value) await loadPrismToolset()
        }
        input.click()
      }
      async function deletePersonalPlugin(plugin) {
        const enabled = prismToolset.enabledPlugins.includes(plugin.pluginId)
        if (!window.confirm(`${plugin.uploaded ? '永久删除上传插件及其可执行代码' : '从当前 Profile 永久删除个人插件 Bundle'}？\n\n${plugin.pluginId}\n版本 ${plugin.version}\n\n${enabled ? '系统将自动切换到自定义模式、停用其工具并保存配置，然后立即删除。' : '系统将保存当前停用状态并立即删除。'}`)) return
        const value = await run('plugin:delete', async signal => {
          const saved = await api('/toolsets', { method: 'POST', body: {
            mode: 'custom', enabledPlugins: prismToolset.enabledPlugins.filter(id => id !== plugin.pluginId),
            enabledTools: prismToolset.enabledTools.filter(tool => !plugin.tools.includes(tool)),
            enabledSkills: prismToolset.enabledSkills.filter(skill => !(plugin.skills || []).includes(skill)),
            expected: { version: prismToolset.version, sha256: prismToolset.sha256 },
          }, signal })
          return api('/toolsets/plugin/delete', { method: 'POST', body: { pluginId: plugin.pluginId, expected: { version: saved.toolset.version, sha256: saved.toolset.sha256 } }, signal })
        }, '个人插件已停用并永久删除。')
        if (value) await loadPrismToolset()
      }
      function importPrismSkillZip() {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.zip,application/zip'
        input.onchange = async () => {
          const file = input.files?.[0]; if (!file) return
          if (file.size > 32 * 1024) { setNotice({ error: true, text: 'ZIP 超过 32 KiB Dashboard 请求上限。' }); return }
          const value = await run('skill:zip', signal => api('/toolsets/skill/import-zip', { method: 'POST', rawBody: file, contentType: 'application/zip', signal }), 'Skill Bundle 已导入。')
          if (value) { await loadPrismToolset(); await editPrismSkill(value.skill.skillId) }
        }
        input.click()
      }
      function copyPrismSkill() { setPrismSkillEditor(current => ({ ...current, skillId: `${current.skillId}-copy`, name: `${current.name}（副本）`, version: undefined, sha256: undefined, isNew: true })); setPrismSkillHistory([]) }
      async function savePrismSkill() {
        const editor = prismSkillEditor
        const body = { skillId: editor.skillId, name: editor.skillId, description: editor.description, whenToUse: '', content: editor.content, enabled: editor.enabled,
          ...(!editor.isNew ? { expected: { version: editor.version, sha256: editor.sha256 } } : {}) }
        const value = await run('skill:save', signal => api('/toolsets/skill', { method: editor.isNew ? 'POST' : 'PUT', body, signal }), editor.isNew ? 'Skill 已创建。' : 'Skill 新版本已保存。')
        if (value) { setPrismSkillEditor({ ...value.skill, isNew: false }); await loadPrismToolset(); await editPrismSkill(value.skill.skillId) }
      }
      async function rollbackPrismSkill(targetVersion) {
        const editor = prismSkillEditor
        if (!window.confirm(`确认回滚 ${editor.skillId} 到修订 ${targetVersion}？系统会创建新的审计记录。`)) return
        const value = await run('skill:rollback', signal => api('/toolsets/skill/rollback', { method: 'POST', body: { skillId: editor.skillId, targetVersion, expected: { version: editor.version, sha256: editor.sha256 } }, signal }), 'Skill 已创建回滚版本。')
        if (value) { await loadPrismToolset(); await editPrismSkill(value.skill.skillId) }
      }
      async function deletePrismSkill(skill = prismSkillEditor) {
        if (!skill?.removable) return
        if (!window.confirm(`永久删除个人 Skill 及其 Bundle，并保留审计 tombstone？\n${skill.skillId}\n修订 ${skill.version} · ${skill.sha256}`)) return
        const value = await run('skill:delete', signal => api('/toolsets/skill/delete', { method: 'POST', body: { skillId: skill.skillId, expected: { version: skill.version, sha256: skill.sha256 } }, signal }), '个人 Skill 已删除。')
        if (value) { if (prismSkillEditor?.skillId === skill.skillId) { setPrismSkillEditor(null); setPrismSkillHistory([]) } await loadPrismToolset() }
      }
      function toolsetsView() {
        if (!status?.services.toolsets || !prismToolset) return h(Empty, null, 'PrismFlow 工具集服务当前不可用。')
        const updateEditor = (field, value) => setPrismSkillEditor(current => ({ ...current, [field]: value }))
        const plugins = [...prismPlugins].sort((left, right) => {
          const originOrder = Number(left.origin !== 'system') - Number(right.origin !== 'system')
          if (originOrder) return originOrder
          return left.pluginId < right.pluginId ? -1 : left.pluginId > right.pluginId ? 1 : 0
        })
        const pluginCards = origin => plugins.filter(plugin => plugin.origin === origin).map(plugin => {
          const enabled = prismToolset.enabledPlugins.includes(plugin.pluginId)
          const enabledToolCount = plugin.tools.filter(tool => prismToolset.enabledTools.includes(tool)).length
          return h('article', { className: `pf-plugin-card${enabled ? ' pf-plugin-card-enabled' : ''}`, key: plugin.pluginId },
            h('div', { className: 'pf-plugin-card-head' },
              h('div', null, h('strong', null, plugin.name), h('span', { className: 'pf-code pf-plugin-id' }, plugin.pluginId)),
              h('span', { className: `pf-badge pf-origin-badge ${origin === 'system' ? 'pf-origin-system' : 'pf-origin-custom'}` }, origin === 'system' ? '系统插件' : plugin.uploaded ? '个人上传' : '个人插件')),
            h('p', { className: 'pf-plugin-description' }, plugin.description),
            h('div', { className: 'pf-plugin-summary' }, h('span', null, `Manifest ${plugin.version}`), h('span', null, `${enabledToolCount} / ${plugin.tools.length} 个工具`)),
            h('label', { className: 'pf-plugin-toggle' }, h('input', { type: 'checkbox', checked: enabled, disabled: prismToolset.mode !== 'custom', onChange: () => togglePlugin(plugin) }), enabled ? '插件已启用' : '插件已停用'),
            h('details', { className: 'pf-plugin-tools' }, h('summary', null, '查看工具'),
              h('div', { className: 'pf-plugin-tool-list' }, plugin.tools.map(tool => h('label', { className: 'pf-tool-option', key: tool },
                h('input', { type: 'checkbox', checked: prismToolset.enabledTools.includes(tool), disabled: prismToolset.mode !== 'custom' || !enabled, onChange: () => togglePluginTool(plugin, tool) }), h('span', { className: 'pf-code' }, tool))))),
            plugin.removable ? h('div', { className: 'pf-plugin-management' },
              h('span', null, enabled ? '删除时自动停用工具、保存配置并移除 Bundle' : plugin.uploaded ? '删除上传的代码与资源' : '永久删除当前 Profile 中的个人插件 Bundle'),
              h(Button, { danger: true, onClick: () => deletePersonalPlugin(plugin), disabled: !!busy }, '删除插件')) : null)
        })
        const skillCards = [...prismSkills].sort((left, right) => {
          const originOrder = Number(left.origin !== 'system-default') - Number(right.origin !== 'system-default')
          if (originOrder) return originOrder
          return left.skillId < right.skillId ? -1 : left.skillId > right.skillId ? 1 : 0
        }).map(skill => h('article', { className: 'pf-skill-card', key: skill.skillId },
          h('div', { className: 'pf-skill-card-head' }, h('strong', { className: 'pf-code' }, skill.skillId),
            h('div', { className: 'pf-skill-card-badges' }, h('span', { className: `pf-badge pf-origin-badge ${skill.origin === 'system-default' ? 'pf-origin-system' : 'pf-origin-custom'}` }, skill.origin === 'system-default' ? '系统默认' : '个人定制'), h(Badge, { enabled: prismToolset.enabledSkills.includes(skill.skillId) }, prismToolset.enabledSkills.includes(skill.skillId) ? 'Chat 已启用' : 'Chat 未启用'))),
          h('p', { className: 'pf-skill-card-description' }, skill.description || '暂无说明'),
          h('div', { className: 'pf-skill-card-actions' },
            h('label', { className: 'pf-check' }, h('input', { type: 'checkbox', checked: prismToolset.enabledSkills.includes(skill.skillId), disabled: !skill.enabled || prismToolset.mode !== 'custom', onChange: () => toggleSkill(skill.skillId) }), '允许 Chat 使用'),
            h(Button, { onClick: () => editPrismSkill(skill.skillId) }, '编辑与历史'))))
        let editorPanel = null
        if (prismSkillEditor) editorPanel = h('div', { className: 'pf-card pf-skill-editor' },
          h('div', { className: 'pf-row pf-space' }, h('h3', null, prismSkillEditor.isNew ? '新增 Skill' : `编辑 ${prismSkillEditor.skillId}`), h(Button, { onClick: () => setPrismSkillEditor(null) }, '关闭')),
          h('p', { className: 'pf-section-help' }, `配置来源：${prismSkillEditor.isNew || prismSkillEditor.origin !== 'system-default' ? '个人定制' : '系统默认'}`),
          h('div', { className: 'pf-form' }, h(Field, { label: 'Skill name / 目录名', value: prismSkillEditor.skillId, disabled: !prismSkillEditor.isNew, onChange: value => updateEditor('skillId', value) }), h(Field, { label: 'description（必须同时说明功能与使用时机）', value: prismSkillEditor.description, onChange: value => updateEditor('description', value) })),
          h('p', { className: 'pf-field-help' }, '保存后物化为标准目录 Bundle：SKILL.md；同目录可以包含 scripts/、references/ 和 assets/，正文使用相对路径引用。'),
          h('label', { className: 'pf-check' }, h('input', { type: 'checkbox', checked: prismSkillEditor.enabled, onChange: event => updateEditor('enabled', event.target.checked) }), 'Skill 已启用'),
          h('div', { className: 'pf-field' }, h('label', null, 'Skill Markdown 指令'), h('textarea', { className: 'pf-textarea pf-workflow-textarea', maxLength: 32000, value: prismSkillEditor.content, onChange: event => updateEditor('content', event.target.value) })),
          h('h4', null, '安全预览'), h('pre', { className: 'pf-preview pf-json' }, prismSkillEditor.content),
          h('div', { className: 'pf-actions pf-skill-save-actions' }, h(Button, { primary: true, onClick: savePrismSkill, disabled: !!busy }, prismSkillEditor.isNew ? '创建 Skill' : '保存新版本'), !prismSkillEditor.isNew ? h(Button, { onClick: copyPrismSkill }, '复制 Skill') : null),
          !prismSkillEditor.isNew && prismSkillHistory.length ? h('div', { className: 'pf-workflow-history' }, h('h4', null, '版本历史'), prismSkillHistory.map(row => h('div', { className: 'pf-row pf-space pf-workflow-history-row', key: row.version }, h('span', { className: 'pf-code' }, `修订 ${row.version} · ${row.action} · ${row.sha256}`), row.version < prismSkillEditor.version ? h(Button, { onClick: () => rollbackPrismSkill(row.version) }, '回滚') : null))) : null,
          !prismSkillEditor.isNew && prismSkillEditor.removable ? h('section', { className: 'pf-skill-danger', 'aria-label': '个人 Skill 危险操作' },
            h('div', { className: 'pf-skill-danger-copy' }, h('strong', null, '删除个人 Skill'), h('span', null, '永久移除当前 Skill Bundle；SQLite 仍保留不可变审计 tombstone。')),
            h(Button, { danger: true, onClick: () => deletePrismSkill(prismSkillEditor), disabled: !!busy }, '永久删除')) : null)
        const promptSuggestionsPanel = promptSuggestions ? h('section', { className: 'pf-card pf-toolset-section' },
          h('header', { className: 'pf-toolset-section-head' },
            h('div', { className: 'pf-toolset-section-title' }, h('h3', null, 'Chat 候选输入文案'), h('p', null, '显示在 Chat 输入框上方；点击只填入输入框，不会自动发送或授予额外权限。')),
            h('span', { className: 'pf-badge' }, `${promptSuggestions.items.filter(item => item.enabled).length} 条已显示`)),
          h('div', { className: 'pf-toolset-section-body' },
            h('div', { className: 'pf-prompt-editor-list' }, ...promptSuggestions.items.map((item, index) => h('div', { className: 'pf-prompt-editor-row', key: item.id },
              h('div', { className: 'pf-prompt-editor-order' },
                h(Button, { onClick: () => movePromptSuggestion(index, -1), disabled: index === 0 || !!busy, 'aria-label': '上移候选文案' }, '↑'),
                h(Button, { onClick: () => movePromptSuggestion(index, 1), disabled: index === promptSuggestions.items.length - 1 || !!busy, 'aria-label': '下移候选文案' }, '↓')),
              h('div', { className: 'pf-field' }, h('label', null, `候选文案 ${index + 1}`), h('textarea', { className: 'pf-textarea', maxLength: 4000, value: item.text,
                onChange: event => updatePromptSuggestion(item.id, { text: event.target.value }) }), h('span', { className: 'pf-counter' }, `${item.text.length} / 4000`)),
              h('div', { className: 'pf-prompt-editor-controls' },
                h('label', { className: 'pf-check' }, h('input', { type: 'checkbox', checked: item.enabled, onChange: event => updatePromptSuggestion(item.id, { enabled: event.target.checked }) }), '显示'),
                h(Button, { danger: true, onClick: () => deletePromptSuggestion(item.id), disabled: !!busy }, '删除'))))),
          h('div', { className: 'pf-toolset-section-actions' },
            h(Button, { onClick: addPromptSuggestion, disabled: !!busy || promptSuggestions.items.length >= 20 }, '新增文案'),
            h(Button, { onClick: loadPrismToolset, disabled: !!busy }, '放弃修改'),
            h(Button, { primary: true, onClick: savePromptSuggestions, disabled: !!busy }, '保存候选文案')))) : null
        const imageGenerationPanel = status?.services.imageGenerationSettings && imageGenerationSettings ? h('section', { className: 'pf-card pf-toolset-section' },
          h('header', { className: 'pf-toolset-section-head' },
            h('div', { className: 'pf-toolset-section-title' }, h('h3', null, '媒体处理与图片生成'), h('p', null, '配置 FFmpeg 视频处理、prismflow_image_generation 接口、模型和输出规格；保存后下一次调用立即生效。')),
            h(Badge, { enabled: imageGenerationCredential?.configured === true }, imageGenerationCredential?.configured ? 'API Key 已配置' : 'API Key 未配置')),
          h('div', { className: 'pf-toolset-section-body' },
            h('div', { className: 'pf-image-settings-grid' },
              h(Field, { className: 'pf-image-endpoint', label: '调用接口 URL', value: imageGenerationSettings.imageApiUrl, help: '接受不含凭证、查询参数和片段的 HTTP 或 HTTPS 地址；生产环境推荐 HTTPS。', onChange: value => editImageGenerationSetting('imageApiUrl', value) }),
              h(Field, { className: 'pf-image-protocol', label: '调用协议', value: imageGenerationSettings.imageApiProtocol, options: [{ value: 'auto', label: '自动识别' }, { value: 'images-generations', label: 'Images Generations' }, { value: 'chat-completions', label: 'Chat Completions' }], onChange: value => editImageGenerationSetting('imageApiProtocol', value) }),
              h(Field, { label: '调用模型', value: imageGenerationSettings.imageModel, help: '填写服务商支持的精确模型 ID。', onChange: value => editImageGenerationSetting('imageModel', value) }),
              h(Field, { className: 'pf-image-compact', label: '图片尺寸', value: imageGenerationSettings.imageSize, placeholder: '1024x1024', onChange: value => editImageGenerationSetting('imageSize', value) }),
              h(Field, { className: 'pf-image-number', label: 'AVIF 质量', type: 'number', min: 1, max: 100, value: imageGenerationSettings.avifQuality, onChange: value => editImageGenerationSetting('avifQuality', value) }),
              h(Field, { className: 'pf-image-number', label: 'AVIF effort', type: 'number', min: 0, max: 9, value: imageGenerationSettings.avifEffort, onChange: value => editImageGenerationSetting('avifEffort', value) })),
            /^http:\/\//iu.test(imageGenerationSettings.imageApiUrl.trim()) ? h('div', { className: 'pf-notice pf-notice-error', style: { margin: '14px 0 0' }, role: 'alert' }, '当前使用明文 HTTP：API Key、提示词和生成结果不会获得传输加密。仅在可信内网或兼容网关中使用。') : null,
            h('section', { className: 'pf-image-credentials', style: { margin: '18px -20px -18px' }, 'aria-label': 'FFmpeg 运行时' },
              h('div', { className: 'pf-image-credential-head' },
                h('div', { className: 'pf-image-credential-copy' }, h('strong', null, 'FFmpeg 视频处理'), h('span', null, '留空时按照当前操作系统、FFMPEG_PATH、PATH 和常见安装目录自动识别；填写时可使用绝对路径或 PATH 中的可执行文件名。')),
                h('div', { className: 'pf-image-credential-state' }, h(Badge, { enabled: ffmpegStatus?.available === true }, ffmpegStatus?.available ? '已识别' : '不可用'), h('span', { className: 'pf-muted' }, ffmpegStatus?.mode === 'configured' ? '手动配置' : '系统自动识别'))),
              h(Field, { label: 'FFmpeg 可执行文件', value: imageGenerationSettings.ffmpegPath, placeholder: '留空自动识别，例如 C:\\ffmpeg\\bin\\ffmpeg.exe 或 /usr/local/bin/ffmpeg',
                help: ffmpegStatus?.available ? `当前使用：${ffmpegStatus.resolvedPath}` : ffmpegStatus?.error || '尚未检测', onChange: value => editImageGenerationSetting('ffmpegPath', value) }))),
          h('div', { className: 'pf-toolset-section-actions' }, h(Button, { onClick: loadPrismToolset, disabled: !!busy }, '放弃修改 / 重新检测'), h(Button, { primary: true, onClick: saveImageGenerationSettings, disabled: !!busy }, '保存媒体与接口配置')),
          h('section', { className: 'pf-image-credentials', 'aria-label': '图片生成 API Key' },
            h('div', { className: 'pf-image-credential-head' },
              h('div', { className: 'pf-image-credential-copy' }, h('strong', null, '图片生成 API Key'), h('span', null, '真实值仅写入 DSH Credential Store，页面不会读取或回显旧值。')),
              h('div', { className: 'pf-image-credential-state' }, h(Badge, { enabled: imageGenerationCredential?.configured === true }, imageGenerationCredential?.configured ? '已配置' : '未配置'), h('span', { className: 'pf-muted' }, `${imageGenerationCredential?.writable && imageGenerationCredential?.allowDashboardWrite ? 'Dashboard 可写' : '只读'}${imageGenerationCredential?.source ? ` · ${imageGenerationCredential.source}` : ''}`))),
            h('div', { className: 'pf-image-credential-row' },
              h(Field, { label: imageGenerationCredential?.configured ? '输入新 API Key 以轮换' : 'API Key', type: 'password', value: imageGenerationCredentialValue, disabled: !!busy || !imageGenerationCredential?.writable || !imageGenerationCredential?.allowDashboardWrite, placeholder: imageGenerationCredential?.configured ? '输入新值（旧值不会显示）' : '在此粘贴 API Key', onChange: setImageGenerationCredentialValue }),
              h('div', { className: 'pf-image-credential-actions' },
                h(Button, { primary: true, onClick: saveImageGenerationCredential, disabled: !!busy || !imageGenerationCredentialValue || !imageGenerationCredential?.writable || !imageGenerationCredential?.allowDashboardWrite }, imageGenerationCredential?.configured ? '轮换 API Key' : '保存 API Key'),
                h(Button, { danger: true, onClick: removeImageGenerationCredential, disabled: !!busy || !imageGenerationCredential?.configured || !imageGenerationCredential?.writable || !imageGenerationCredential?.allowDashboardWrite }, '移除 API Key'))))) : null
        return h('section', { className: 'pf-toolset-page' },
          h('header', { className: 'pf-toolset-header' },
            h('div', { className: 'pf-toolset-header-copy' }, h('h2', { className: 'pf-section-title' }, 'PrismFlow 工具集'), h('p', { className: 'pf-section-help' }, '“导出全部配置”会加密备份当前工作流及其完整历史、数据源、发布与存储目标、图片设置、工具集及相关 Cookie/API Key；不导出已抓取内容。')),
            h('div', { className: 'pf-toolset-header-actions' },
              h(Button, { onClick: exportPrismFlowData, disabled: !!busy }, '导出全部配置'),
              h(Button, { onClick: importPrismFlowData, disabled: !!busy }, '导入全部配置'))),
          h('div', { className: 'pf-toolset-stack' },
            promptSuggestionsPanel,
            imageGenerationPanel,
            h('section', { className: 'pf-card pf-toolset-section' },
              h('header', { className: 'pf-toolset-section-head' },
                h('div', { className: 'pf-toolset-section-title' }, h('h3', null, '插件与 Skill 配置'), h('p', null, '配置模式同时控制插件、插件工具和 Skill；Skill 只提供指令，不授予工具权限。')),
                h('span', { className: 'pf-badge' }, prismToolset.mode === 'core' ? '系统默认组合' : prismToolset.mode === 'complete' ? '全部启用' : '自定义选择')),
              h('div', { className: 'pf-toolset-section-body' },
                h(Field, { className: 'pf-toolset-mode', label: '插件与 Skill 配置模式', help: prismToolset.mode === 'core' ? '仅启用系统插件、系统工具和系统默认 Skill；不启用个人插件或个人定制 Skill。' : prismToolset.mode === 'complete' ? '启用全部系统插件、个人插件、工具和当前可用 Skill。' : '分别选择插件、插件内工具和 Skill；Skill 选择不会绕过插件权限。', value: prismToolset.mode, options: [{ value: 'core', label: '系统默认组合' }, { value: 'complete', label: '全部启用' }, { value: 'custom', label: '自定义选择' }], onChange: mode => setPrismToolset(current => {
                  const selectedPlugins = mode === 'core' ? plugins.filter(plugin => plugin.origin === 'system') : mode === 'complete' ? plugins : null
                  const enabledPlugins = selectedPlugins ? selectedPlugins.map(plugin => plugin.pluginId) : current.enabledPlugins
                  const enabledTools = selectedPlugins ? selectedPlugins.flatMap(plugin => plugin.tools) : current.enabledTools
                  const pluginSkillIds = new Set((selectedPlugins ?? []).flatMap(plugin => plugin.skills))
                  const enabledSkills = mode === 'core' ? prismSkills.filter(skill => skill.enabled && skill.origin === 'system-default' && pluginSkillIds.has(skill.skillId)).map(skill => skill.skillId) : mode === 'complete' ? prismSkills.filter(skill => skill.enabled).map(skill => skill.skillId) : current.enabledSkills
                  return { ...current, mode, enabledPlugins, enabledTools, enabledSkills }
                }) }))),
            h('section', { className: 'pf-card pf-toolset-section pf-plugin-section' },
              h('header', { className: 'pf-toolset-section-head' }, h('div', { className: 'pf-toolset-section-title' }, h('h3', null, '系统插件'), h('p', null, '随 @prismflow/dsh 提供，不能删除；系统默认组合下全部启用。')), h('span', { className: 'pf-badge pf-origin-system' }, `${plugins.filter(plugin => plugin.origin === 'system').length} 个`)),
              h('div', { className: 'pf-toolset-section-body' }, h('div', { className: 'pf-plugin-grid' }, pluginCards('system')))),
            h('section', { className: 'pf-card pf-toolset-section pf-plugin-section' },
              h('header', { className: 'pf-toolset-section-head' }, h('div', { className: 'pf-toolset-section-title' }, h('h3', null, '个人插件'), h('p', null, '内置个人插件与上传插件统一放在个人插件区；上传代码拥有 DSH 进程权限。')),
                h('div', { className: 'pf-toolset-header-actions' }, h('span', { className: 'pf-badge pf-origin-custom' }, `${plugins.filter(plugin => plugin.origin === 'personal').length} 个`), h(Button, { onClick: importPersonalPluginZip, disabled: !!busy }, '上传个人插件 ZIP'))),
              h('div', { className: 'pf-toolset-section-body' }, h('div', { className: 'pf-plugin-grid' }, pluginCards('personal')))),
            h('section', { className: 'pf-card pf-toolset-section pf-skill-section' },
              h('header', { className: 'pf-toolset-section-head' },
                h('div', { className: 'pf-toolset-section-title' }, h('h3', null, 'PrismFlow Skills'), h('p', null, 'Skill 只提供渐进式指令，不授予插件或工具权限；个人定制 Skill 可以直接删除；删除 Bundle 后仍保留审计 tombstone。')),
                h('div', { className: 'pf-toolset-header-actions' }, h(Button, { onClick: importPrismSkillZip, disabled: !!busy }, '上传 Skill ZIP'), h(Button, { onClick: newPrismSkill }, '手动新增 Skill'))),
              h('div', { className: 'pf-toolset-section-body' }, h('div', { className: 'pf-toolset-grid' }, skillCards))),
            editorPanel),
          h('div', { className: 'pf-publisher-save-footer pf-publisher-changebar' }, h('div', { className: 'pf-publisher-change-copy' }, h('strong', null, `插件与 Skill 配置修订 ${prismToolset.version}`), h('span', null, 'Skill 变更即时进入后续目录；插件和工具变更需重启 DSH。')), h('div', { className: 'pf-actions' }, h(Button, { onClick: loadPrismToolset }, '放弃修改'), h(Button, { primary: true, onClick: savePrismToolset, disabled: !!busy }, '保存插件与 Skill 配置'))))
      }

      function overviewView() {
        if (!status) return h(Empty, null, '正在读取 PrismFlow 运行状态…')
        const onlineCount = serviceCards.filter(([, enabled]) => enabled).length
        const flowCards = [
          { number: '01', title: '数据源与采集', enabled: status.services.sources && status.services.sourceSettings && status.services.contentStore,
            description: '在工作台管理 RSS、Follow、GitHub Trending 与 AI Search；由 Chat 执行抓取、逐条隔离和可信入库。', tab: 'source-settings', action: '管理数据源' },
          { number: '02', title: '工具与 Skills', enabled: status.services.toolsets && status.services.imageGenerationSettings,
            description: '控制 Chat 可调用的 PrismFlow 工具、标准 Skill Bundle，以及图片生成端点和 write-only 凭证。', tab: 'toolsets', action: '配置工具集' },
          { number: '03', title: 'Selection 与生成', enabled: status.services.generatorWorkflows && status.services.production,
            description: 'Chat 从全部来源创建 AI Selection 和精确 Generation Request，再按已部署工作流执行多阶段生成。', tab: 'workflows', action: '查看工作流' },
          { number: '04', title: '草稿与审批', enabled: status.services.production,
            description: 'Chat 或工作台可编辑未审批稿、派生图片修订稿；审批、拒绝和删除始终由工作台控制。', tab: 'review', action: '审核草稿' },
          { number: '05', title: '受控发布', enabled: status.services.publishers && status.services.production,
            description: 'Dashboard 或 Chat 只能将精确批准的 Artifact 发布到 Profile 预配置的 Local、GitHub、R2 或微信目标。', tab: 'publisher-profile', action: '管理发布目标' },
          { number: '06', title: '回执与对账', enabled: status.services.receipts,
            description: '每次发布保留 Attempt、Receipt 与 Artifact 身份；微信未知结果保持阻塞，直到操作员精确对账。', tab: 'receipts', action: '查看发布审计' },
        ]
        const metrics = [
          ['已注册数据源', status.counts.sources ?? 0, `${status.counts.sourceSettings ?? 0} 项来源设置`],
          ['工作流定义', status.counts.generatorWorkflows ?? 0, `${status.counts.generators ?? 0} 个生成器`],
          ['发布目标', status.counts.publishers ?? 0, 'Profile 固定目标'],
          ['RSS 输出', status.counts.rssOutputs ?? 0, 'SQLite 持久化记录'],
        ]
        return h('section', { className: 'pf-overview-page' },
          h('header', { className: 'pf-overview-hero' },
            h('div', null,
              h('div', { className: 'pf-overview-eyebrow' }, h(Badge, { enabled: onlineCount === serviceCards.length }, `${onlineCount}/${serviceCards.length} 项服务可用`), h('span', { className: 'pf-version' }, `@prismflow/dsh ${status.pluginVersion}`)),
              h('h2', null, '从可信内容到可审计发布'),
              h('p', null, '流光工作台是 PrismFlow 的配置、审批与审计控制面；DSH Chat 负责采集、Selection、生成、未审批修订和受控执行。两端共享同一套 SQLite provenance 与 Artifact 安全边界。')),
            h('div', { className: 'pf-overview-hero-actions' },
              h(Button, { onClick: refreshOverview, disabled: !!busy }, '刷新运行状态'),
              h(Button, { onClick: () => switchDashboardTab('toolsets') }, '打开工具集'),
              h(Button, { primary: true, onClick: () => switchDashboardTab('review') }, '进入草稿审核'))),
          h('div', { className: 'pf-overview-metrics', role: 'list', 'aria-label': 'PrismFlow 运行指标' }, ...metrics.map(([label, value, help]) => h('div', { className: 'pf-overview-metric', role: 'listitem', key: label }, h('span', null, label), h('strong', null, String(value)), h('small', null, help)))),
          h('section', { className: 'pf-overview-section' },
            h('div', { className: 'pf-overview-section-head' }, h('div', null, h('h3', null, '实际工作链路'), h('p', null, '每个入口只承担其授权范围内的操作，避免配置、执行与审批互相越权。'))),
            h('div', { className: 'pf-overview-flow' }, ...flowCards.map(item => h('article', { className: 'pf-overview-flow-card', key: item.number },
              h('div', { className: 'pf-overview-flow-head' }, h('span', { className: 'pf-overview-step' }, item.number), h(Badge, { enabled: item.enabled }, item.enabled ? '可用' : '未启用')),
              h('h4', null, item.title), h('p', null, item.description), h(Button, { onClick: () => switchDashboardTab(item.tab) }, item.action))))),
          h('div', { className: 'pf-overview-bottom' },
            h('section', { className: 'pf-card pf-overview-health' },
              h('div', { className: 'pf-overview-section-head' }, h('div', null, h('h3', null, '服务健康'), h('p', null, onlineCount === serviceCards.length ? '当前控制面依赖全部可用。' : '存在未启用服务；对应功能入口会保持只读或不可用。'))),
              h('div', { className: 'pf-overview-health-list' }, ...serviceCards.map(([label, enabled, value]) => h('span', { className: 'pf-overview-health-item', key: label, title: String(value) }, h('span', { className: `pf-overview-dot${enabled ? ' pf-overview-dot-on' : ''}` }), `${label} · ${enabled ? '正常' : '未启用'}`)))),
            h('aside', { className: 'pf-card pf-overview-guardrails' },
              h('h3', null, '关键安全边界'),
              h('ul', null,
                h('li', null, 'Chat 不能审批或删除 Draft。'),
                h('li', null, '批准后正文、图片和 Artifact Binding 不可原地修改。'),
                h('li', null, '发布只能使用 Profile 固定目标与 write-only Credential Ref。'),
                h('li', null, '微信结果未知时禁止自动重试，必须精确对账。')))),
        )
      }

      function editSourceField(key, value) { setSourceEditor(current => ({ ...current, [key]: value })) }
      function beginCreateSource(type = 'github-trending') { editingSourceRevision.current = ''; setEditingSourceId(''); setSourceEditor(defaultManagedSource(type)) }
      function beginEditSource(source) {
        const values = { ...source, selectorType: source.feedId ? 'feed' : 'list', listId: source.listId || '', feedId: source.feedId || '', credentialSlotId: source.credentialSlotId || '' }
        for (const key of ['limit', 'fetchDays', 'fetchPages', 'view', 'pageDelayMs', 'detailDelayMs']) if (values[key] !== undefined) values[key] = String(values[key])
        editingSourceRevision.current = source.updatedAt
        setEditingSourceId(source.settingsId); setSourceEditor(values)
      }
      function sourcePayload(source = sourceEditor) {
        const common = { type: source.type, id: source.id.trim(), name: source.name.trim(), category: source.category, enabled: source.enabled, limit: optionalInteger(source.limit) }
        if (source.type === 'github-trending') return { ...common, since: source.since, spokenLanguageCode: source.spokenLanguageCode }
        if (source.type === 'rss') return { ...common, url: source.url.trim() }
        if (source.type === 'ai-search') return { ...common, keyword: source.keyword.trim() }
        const selector = source.selectorType === 'feed' ? { feedId: source.feedId.trim() } : { listId: source.listId.trim() }
        return { ...common, ...selector, fetchDays: optionalInteger(source.fetchDays), fetchPages: optionalInteger(source.fetchPages), view: optionalInteger(source.view), pageDelayMs: optionalInteger(source.pageDelayMs), detailDelayMs: optionalInteger(source.detailDelayMs), credentialSlotId: source.credentialSlotId || undefined }
      }
      async function saveSourceSetting() {
        if (!sourceEditorValid(sourceEditor)) { setNotice({ type: 'error', text: '请补全并检查当前 Item 的配置项' }); return }
        if (editingSourceId && !editingSourceRevision.current) { setNotice({ type: 'error', text: '当前 Item 缺少编辑版本，请重新进入编辑' }); return }
        const body = editingSourceId
          ? { mode: 'update', source: sourcePayload(), expectedSettingsId: editingSourceId, expectedUpdatedAt: editingSourceRevision.current }
          : { mode: 'create', source: sourcePayload() }
        const value = await run('source-settings:save', signal => api('/source-settings/save', { body, signal }), '数据源 Item 已保存并立即生效')
        if (value) { beginCreateSource(sourceEditor.type); await loadSourceSettings(); void refreshOverview() }
      }
      async function deleteSourceSetting(settingsId) {
        const value = await run('source-settings:delete', signal => api('/source-settings/delete', { body: { settingsId }, signal }), '数据源 Item 已删除')
        if (value) { if (editingSourceId === settingsId) beginCreateSource(); await loadSourceSettings(); void refreshOverview() }
      }
      async function toggleSourceSetting(source) {
        const values = { ...source, enabled: !source.enabled, selectorType: source.feedId ? 'feed' : 'list' }
        const value = await run('source-settings:toggle', signal => api('/source-settings/save', { body: { mode: 'update', source: sourcePayload(values), expectedSettingsId: source.settingsId, expectedUpdatedAt: source.updatedAt }, signal }), values.enabled ? '数据源 Item 已启用' : '数据源 Item 已停用')
        if (value) { await loadSourceSettings(); void refreshOverview() }
      }
      async function setAdapterEnabled(adapter, enabled) {
        const value = await run(`source-settings:adapter:${adapter.value}`, signal => api('/source-settings/adapter', { body: { type: adapter.value, enabled }, signal }), enabled ? `${adapter.label} Adapter 已启用` : `${adapter.label} Adapter 已停用；Item 状态保持不变`)
        if (value) await loadSourceSettings()
      }
      async function setCredential(slot) {
        const value = credentialValues[slot.id] || ''
        if (!value) { setNotice({ type: 'error', text: '请输入非空凭证值' }); return }
        const committed = await run(`credential:set:${slot.id}`, signal => api('/source-settings/credential/set', { body: { slotId: slot.id, value }, signal }), '凭证已安全保存并立即生效')
        if (committed) { setCredentialValues(current => ({ ...current, [slot.id]: '' })); await loadSourceSettings() }
      }
      async function unsetCredential(slot) {
        const committed = await run(`credential:unset:${slot.id}`, signal => api('/source-settings/credential/unset', { body: { slotId: slot.id }, signal }), '凭证已移除')
        if (committed) { setCredentialValues(current => ({ ...current, [slot.id]: '' })); await loadSourceSettings() }
      }
      function credentialView() {
        const slots = credentialSlots.filter(slot => slot.usage === 'follow-cookie')
        return h('div', { className: 'pf-card', style: { marginBottom: 16 } },
          h('h3', null, 'Follow / Folo 凭证'),
          h('p', null, '这里只管理部署者预定义的 Follow Cookie 槽位。页面永远不会显示凭证值或凭证引用；保存后下一次 Chat 抓取立即使用。'),
          slots.length ? slots.map(slot => h('div', { key: slot.id, style: { marginTop: 12 } },
            h('div', { className: 'pf-row pf-space' }, h('strong', null, slot.name), h(Badge, { enabled: slot.configured }, slot.configured ? '已配置' : '未配置')),
            h('p', { className: 'pf-muted' }, `${slot.writable && slot.allowDashboardWrite ? 'Dashboard 可写' : '只读'}${slot.source ? ` · 来源 ${slot.source}` : ''}`),
            h('div', { className: 'pf-form' },
              h(Field, { label: '新的 Cookie 值', type: 'password', value: credentialValues[slot.id] || '', disabled: !!busy || !slot.writable || !slot.allowDashboardWrite, placeholder: slot.configured ? '输入新值以轮换' : '输入 Cookie', onChange: v => setCredentialValues(current => ({ ...current, [slot.id]: v })) }),
              h(Button, { primary: true, onClick: () => setCredential(slot), disabled: !!busy || !slot.writable || !slot.allowDashboardWrite || !(credentialValues[slot.id] || '') }, slot.configured ? '轮换凭证' : '保存凭证'),
              h(Button, { danger: true, onClick: () => unsetCredential(slot), disabled: !!busy || !slot.configured || !slot.writable || !slot.allowDashboardWrite }, '移除凭证')),
          )) : h('p', { className: 'pf-muted' }, '部署者尚未配置 Follow Cookie 凭证槽位。请在 Profile 的 credentialSlots 中添加 usage: follow-cookie。'))
      }
      function sourceSettingsView() {
        if (!status?.services.sourceSettings) return h(Empty, null, '可视化数据源配置未启用。请由部署者启用 prismflow-store-source-settings；该服务需要 Storage Domain。')
        const followSlots = credentialSlots.filter(slot => slot.usage === 'follow-cookie')
        const grouped = sourceAdapters.map(adapter => ({
          ...adapter,
          enabled: adapterStates.find(state => state.type === adapter.value)?.enabled !== false,
          sources: sourceSettings.filter(source => source.type === adapter.value),
        }))
        return h(React.Fragment, null,
          h('h2', { className: 'pf-section-title' }, '数据源配置'),
          h('p', { className: 'pf-section-help' }, '按 PrismFlow 原有 Adapter + Items 模型配置：Adapter 表示来源类型，下面每一项都是可独立启停的 Item。本页不执行抓取或处理，所有数据操作仍由 DSH Chat Agent 调用。'),
          h('div', { className: 'pf-notice' }, '网络由 DSH Host / 部署环境统一控制，不提供任意代理、Endpoint 或执行器输入。'),
          h(credentialView),
          h('div', { className: 'pf-card', style: { marginBottom: 16 } },
            h('div', { className: 'pf-row pf-space' }, h('h3', null, editingSourceId ? `编辑 ${sourceAdapters.find(item => item.value === sourceEditor.type)?.label} Item` : `新增 ${sourceAdapters.find(item => item.value === sourceEditor.type)?.label} Item`), editingSourceId ? h(Button, { onClick: () => beginCreateSource(sourceEditor.type), disabled: !!busy }, '取消编辑') : null),
            h('div', { className: 'pf-form' },
              h(Field, { label: 'Adapter', value: sourceEditor.type, disabled: !!editingSourceId, options: sourceAdapters, onChange: beginCreateSource }),
              h(Field, { label: 'ID', value: sourceEditor.id, disabled: !!editingSourceId, placeholder: '例如 daily / rss-example', onChange: v => editSourceField('id', v) }),
              h(Field, { label: '名称', value: sourceEditor.name, placeholder: 'Item 显示名称', onChange: v => editSourceField('name', v) }),
              h(Field, { label: '分类', value: sourceEditor.category, options: categoryOptions, onChange: v => editSourceField('category', v) }),
              h(Field, { label: '启用', value: sourceEditor.enabled ? 'true' : 'false', options: [{ value: 'true', label: '启用' }, { value: 'false', label: '停用' }], onChange: v => editSourceField('enabled', v === 'true') }),
              h(Field, { label: '抓取上限', type: 'number', min: 1, max: sourceLimitMaximum(sourceEditor.type), value: sourceEditor.limit, onChange: v => editSourceField('limit', v) }),
              sourceEditor.type === 'github-trending' ? h(Field, { label: '时间范围 (since)', value: sourceEditor.since, options: [{ value: 'daily', label: '每日 daily' }, { value: 'weekly', label: '每周 weekly' }, { value: 'monthly', label: '每月 monthly' }], onChange: v => editSourceField('since', v) }) : null,
              sourceEditor.type === 'github-trending' ? h(Field, { label: '口语语言', value: sourceEditor.spokenLanguageCode, options: [{ value: '', label: '不限' }, { value: 'en', label: '英语 en' }, { value: 'zh', label: '中文 zh' }], onChange: v => editSourceField('spokenLanguageCode', v) }) : null,
              sourceEditor.type === 'rss' ? h(Field, { label: 'RSS 地址 (rssUrl)', value: sourceEditor.url, placeholder: 'https://example.com/feed.xml', onChange: v => editSourceField('url', v) }) : null,
              sourceEditor.type === 'ai-search' ? h(Field, { label: '搜索关键词', value: sourceEditor.keyword, placeholder: '固定研究主题', onChange: v => editSourceField('keyword', v) }) : null,
              sourceEditor.type === 'follow' ? h(Field, { label: '选择器类型', value: sourceEditor.selectorType, options: [{ value: 'list', label: 'List' }, { value: 'feed', label: 'Feed' }], onChange: v => setSourceEditor(current => ({ ...current, selectorType: v, listId: '', feedId: '' })) }) : null,
              sourceEditor.type === 'follow' ? h(Field, { label: sourceEditor.selectorType === 'feed' ? 'Feed ID' : 'List ID', value: sourceEditor.selectorType === 'feed' ? sourceEditor.feedId : sourceEditor.listId, placeholder: '必须填写一个选择器 ID', onChange: v => editSourceField(sourceEditor.selectorType === 'feed' ? 'feedId' : 'listId', v) }) : null,
              sourceEditor.type === 'follow' ? h(Field, { label: '抓取天数', type: 'number', min: 1, max: 365, value: sourceEditor.fetchDays, onChange: v => editSourceField('fetchDays', v) }) : null,
              sourceEditor.type === 'follow' ? h(Field, { label: '抓取页数', type: 'number', min: 1, max: 20, value: sourceEditor.fetchPages, onChange: v => editSourceField('fetchPages', v) }) : null,
              sourceEditor.type === 'follow' ? h(Field, { label: '视图模式 (view)', type: 'number', min: 0, max: 100, value: sourceEditor.view, onChange: v => editSourceField('view', v) }) : null,
              sourceEditor.type === 'follow' ? h(Field, { label: '凭证槽位（可选）', value: sourceEditor.credentialSlotId, options: [{ value: '', label: '不使用凭证' }, ...followSlots.map(slot => ({ value: slot.id, label: `${slot.name}${slot.configured ? '（已配置）' : '（未配置）'}` }))], onChange: v => editSourceField('credentialSlotId', v) }) : null,
              h(Button, { primary: true, onClick: saveSourceSetting, disabled: !!busy || !sourceEditorValid(sourceEditor) }, editingSourceId ? '保存 Item 修改' : '新增 Item')),
            sourceEditor.type === 'follow' ? h('details', null, h('summary', null, '高级延迟设置'), h('div', { className: 'pf-form', style: { marginTop: 10 } },
              h(Field, { label: '分页延迟 ms', type: 'number', min: 0, max: 60000, value: sourceEditor.pageDelayMs, onChange: v => editSourceField('pageDelayMs', v) }),
              h(Field, { label: '详情延迟 ms', type: 'number', min: 0, max: 60000, value: sourceEditor.detailDelayMs, onChange: v => editSourceField('detailDelayMs', v) }))) : null,
            sourceEditor.type === 'github-trending' ? h('p', null, '固定 Endpoint：https://github.com/trending') : null,
            sourceEditor.type === 'follow' ? h('p', null, '固定 Endpoint：https://api.folo.is/entries；List ID 与 Feed ID 必须且只能选择一种。') : null,
            sourceEditor.type === 'ai-search' ? h('p', null, '固定执行：当前 DSH Chat Agent → spawn → web_search。') : null),
          h('h3', null, 'Adapters 与 Items'),
          h('div', { className: 'pf-grid' }, grouped.map(adapter => h('div', { className: 'pf-card', key: adapter.value },
            h('div', { className: 'pf-row pf-space' }, h('h3', null, adapter.label), h(Badge, { enabled: adapter.enabled }, adapter.enabled ? 'Adapter 已启用' : 'Adapter 已停用')),
            h('p', { className: 'pf-muted' }, `${adapter.sources.length} Items · 停用 Adapter 不会修改各 Item 的启用状态`),
            h('div', { className: 'pf-actions' }, h(Button, { onClick: () => setAdapterEnabled(adapter, !adapter.enabled), disabled: !!busy }, adapter.enabled ? '停用 Adapter' : '启用 Adapter')),
            adapter.sources.length ? adapter.sources.map(source => h('div', { key: source.settingsId, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 10, marginTop: 10 } },
              h('div', { className: 'pf-row pf-space' }, h('strong', null, source.name), h(Badge, { enabled: source.enabled && adapter.enabled }, source.enabled ? (adapter.enabled ? 'Item 已启用' : 'Item 已启用 / Adapter 停用') : 'Item 已停用')),
              h('p', { className: 'pf-code' }, `${source.id} · ${source.category} · 上限 ${source.limit}`),
              source.type === 'rss' ? h('p', { className: 'pf-code' }, source.url) : null,
              source.type === 'ai-search' ? h('p', null, `关键词：${source.keyword}`) : null,
              h('div', { className: 'pf-actions' }, h(Button, { onClick: () => beginEditSource(source), disabled: !!busy }, '编辑 Item'), h(Button, { onClick: () => toggleSourceSetting(source), disabled: !!busy }, source.enabled ? '停用' : '启用'), h(Button, { danger: true, onClick: () => deleteSourceSetting(source.settingsId), disabled: !!busy }, '删除')))) : h('p', { className: 'pf-muted' }, '暂无 Item'),
            h('div', { className: 'pf-actions' }, h(Button, { onClick: () => beginCreateSource(adapter.value), disabled: !!busy }, `新增 ${adapter.label} Item`))))))
      }

      function contentDate(value) {
        if (!value) return '—'
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
      }
      function updateContentQuery(field, value) { setContentQuery(current => ({ ...current, [field]: value })) }
      function commitContentQuery(patch = {}) {
        const next = { ...contentQuery, ...patch }
        setContentQuery(next)
        void loadContent(next)
      }
      function contentView() {
        if (!status?.services.contentStore) return h(Empty, null, 'Content Store 未启用。请由部署者启用 prismflow-store-content。')
        const totalPages = Math.max(1, Math.ceil(contentPage.total / contentQuery.pageSize))
        const categoryOptions = [{ value: '', label: '全部分类' }, ...contentPage.categories.map(row => ({ value: row.category, label: `${row.category} (${row.count})` }))]
        const aiProcessedOptions = [{ value: '', label: '全部数据' }, { value: 'true', label: '已被 AI 处理' }, { value: 'false', label: '尚未被 AI 处理' }]
        const sortOptions = [
          { value: 'publishedAt', label: '发布时间' }, { value: 'fetchedAt', label: '抓取时间' }, { value: 'updatedAt', label: '更新时间' },
          { value: 'title', label: '标题' }, { value: 'source', label: '来源' }, { value: 'category', label: '分类' },
        ]
        return h('div', { className: 'pf-content-page' },
          h('div', { className: 'pf-review-header' },
            h('div', null, h('h2', { className: 'pf-section-title' }, '已抓取数据'), h('p', { className: 'pf-section-help' }, '查看 Content Store 中的全部已抓取记录。搜索、分类筛选、排序和分页均在服务端执行。')),
            h(Badge, { enabled: true }, `${contentPage.total} 条`)),
          h('form', { className: 'pf-content-toolbar', onSubmit: event => { event.preventDefault(); commitContentQuery({ page: 1 }) } },
            h(Field, { label: '搜索', value: contentQuery.search, placeholder: '标题、摘要、来源或作者', maxLength: 256, onChange: value => updateContentQuery('search', value) }),
            h(Field, { label: '分类', value: contentQuery.category, options: categoryOptions, onChange: value => commitContentQuery({ category: value, page: 1 }) }),
            h(Field, { label: '排序字段', value: contentQuery.sortBy, options: sortOptions, onChange: value => commitContentQuery({ sortBy: value, page: 1 }) }),
            h(Field, { label: '顺序', value: contentQuery.sortOrder, options: [{ value: 'desc', label: '降序' }, { value: 'asc', label: '升序' }], onChange: value => commitContentQuery({ sortOrder: value, page: 1 }) }),
            h('div', { className: 'pf-actions' }, h(Button, { primary: true, disabled: !!busy, onClick: () => commitContentQuery({ page: 1 }) }, '搜索'), h(Button, { type: 'button', disabled: !!busy, onClick: () => commitContentQuery({ search: '', category: '', aiProcessed: '', sortBy: 'publishedAt', sortOrder: 'desc', page: 1 }) }, '重置'))),
          h('div', { className: 'pf-row pf-space', style: { marginBottom: 10 } },
            h(Field, { label: 'AI 处理', value: contentQuery.aiProcessed, options: aiProcessedOptions, onChange: value => commitContentQuery({ aiProcessed: value, page: 1 }) }),
            h(Field, { label: '每页', value: String(contentQuery.pageSize), options: [10, 20, 50, 100].map(value => ({ value: String(value), label: `${value} 条` })), onChange: value => commitContentQuery({ pageSize: Number(value), page: 1 }) })),
          contentPage.records.length ? h('div', { className: 'pf-content-table-wrap' }, h('table', { className: 'pf-content-table' },
            h('thead', null, h('tr', null, h('th', null, '标题与摘要'), h('th', null, '来源'), h('th', null, '分类'), h('th', null, 'AI 处理'), h('th', null, '发布时间'), h('th', null, '抓取时间'))),
            h('tbody', null, contentPage.records.map(record => h('tr', { key: record.storeId },
              h('td', null,
                record.url ? h('a', { className: 'pf-content-title pf-content-title-link', href: record.url, target: '_blank', rel: 'noopener noreferrer' }, record.title) : h('span', { className: 'pf-content-title' }, record.title),
                record.description ? h('span', { className: 'pf-content-summary' }, record.description) : null,
                h('details', { className: 'pf-content-details' }, h('summary', null, '查看完整记录'), h('div', { className: 'pf-content-details-body' },
                  h('strong', null, '正文摘要'), record.description || '—',
                  record.sourceAiSummary ? h(React.Fragment, null, h('strong', null, '来源AI摘要'), record.sourceAiSummary) : null,
                  Number.isInteger(record.aiScore) ? h(React.Fragment, null,
                    h('strong', null, 'AI评分'), `${record.aiScore} / 100`,
                    h('strong', null, 'AI摘要'), record.aiSummary,
                    h('strong', null, '评分理由'), record.aiReason,
                    h('strong', null, '审核时间'), contentDate(record.aiReviewedAt)) : null,
                  h('strong', null, '记录标识'), `Store ID: ${record.storeId}\nSource ID: ${record.sourceId}\nExternal ID: ${record.externalId}\n首次发现: ${contentDate(record.firstSeenAt)}\n最后更新: ${contentDate(record.updatedAt)}`))),
              h('td', { className: 'pf-content-source' }, h('strong', null, record.source || '—'), h('span', null, record.author || record.sourceId || '—')),
              h('td', null, h('span', { className: 'pf-badge' }, record.category || '未分类')),
              h('td', null, h(Badge, { enabled: record.aiProcessed === true }, record.aiProcessed === true ? '已处理' : '未处理')),
              h('td', { className: 'pf-content-date' }, contentDate(record.publishedAt)),
              h('td', { className: 'pf-content-date' }, contentDate(record.fetchedAt))))))) : h(Empty, null, '没有符合当前条件的已抓取数据。'),
          h('div', { className: 'pf-content-pagination' },
            h('span', { className: 'pf-muted' }, `第 ${Math.min(contentQuery.page, totalPages)} / ${totalPages} 页 · 共 ${contentPage.total} 条`),
            h('div', { className: 'pf-actions' },
              h(Button, { disabled: !!busy || contentQuery.page <= 1, onClick: () => commitContentQuery({ page: contentQuery.page - 1 }) }, '上一页'),
              h(Button, { disabled: !!busy || contentQuery.page >= totalPages, onClick: () => commitContentQuery({ page: contentQuery.page + 1 }) }, '下一页'),
              h(Button, { disabled: !!busy, onClick: () => loadContent(contentQuery) }, '刷新'))))
      }

      function workflowContent(value) {
        return value ? { generatorId: value.generatorId, generatorName: value.generatorName, description: value.description, steps: value.steps } : null
      }
      function workflowDirty() { return JSON.stringify(workflowContent(workflowEditor)) !== JSON.stringify(workflowContent(workflowBaseline)) }
      function confirmWorkflowDiscard() { return !workflowDirty() || window.confirm('当前有未保存的工作流修改。继续将放弃全部修改。') }
      function selectWorkflow(id) { if (confirmWorkflowDiscard()) void loadWorkflows(id) }
      function newWorkflow() {
        if (!confirmWorkflowDiscard()) return
        const value = { kind: 'new', generatorId: '', generatorName: '', description: '', enabled: true,
          steps: [{ id: 'step-1', name: '步骤 1', persona: '', processPrompt: '' }] }
        setWorkflowEditor(value); setWorkflowBaseline(null); setWorkflowHistory([]); setHistoricalWorkflow(null); setWorkflowHistoryExpanded(false); setActiveWorkflowStepId('step-1')
      }
      function updateWorkflow(field, value) { setWorkflowEditor(current => current ? { ...current, [field]: value } : current) }
      function updateWorkflowStep(index, field, value) {
        setWorkflowEditor(current => current ? { ...current, steps: current.steps.map((step, item) => item === index ? { ...step, [field]: value } : step) } : current)
      }
      function uniqueStepId(steps, base = 'step') {
        let suffix = steps.length + 1; let id = `${base}-${suffix}`
        while (steps.some(step => step.id === id)) { suffix += 1; id = `${base}-${suffix}` }
        return id
      }
      function scheduleWorkflowStepFocus(stepId, announcement) {
        pendingWorkflowStepFocus.current = { stepId, announcement }
        setWorkflowStepAnnouncement('')
        setActiveWorkflowStepId(stepId)
      }
      function addWorkflowStep(copyIndex) {
        if (!workflowEditor || workflowEditor.steps.length >= 8) return
        const copying = Number.isInteger(copyIndex)
        const source = copying ? workflowEditor.steps[copyIndex] : { name: '', persona: '', processPrompt: '' }
        const step = { ...source, id: uniqueStepId(workflowEditor.steps, copying ? `${source.id}-copy` : 'step'), name: copying ? `${source.name} 副本` : `步骤 ${workflowEditor.steps.length + 1}` }
        const target = copying ? copyIndex + 1 : workflowEditor.steps.length
        const steps = [...workflowEditor.steps]; steps.splice(target, 0, step)
        setWorkflowEditor({ ...workflowEditor, steps })
        scheduleWorkflowStepFocus(step.id, `${copying ? '已复制为' : '已添加'}步骤 ${target + 1}：${step.name || step.id}`)
      }
      function removeWorkflowStep(index) {
        if (!workflowEditor || workflowEditor.steps.length <= 1 || index < 0 || index >= workflowEditor.steps.length) return
        const steps = workflowEditor.steps.filter((_step, item) => item !== index)
        const target = Math.min(index, steps.length - 1)
        const step = steps[target]
        setWorkflowEditor({ ...workflowEditor, steps })
        scheduleWorkflowStepFocus(step.id, `已移除步骤 ${index + 1}；当前步骤 ${target + 1}：${step.name || step.id}`)
      }
      function moveWorkflowStep(index, direction) {
        if (!workflowEditor) return
        const target = index + direction
        if (target < 0 || target >= workflowEditor.steps.length) return
        const steps = [...workflowEditor.steps]; [steps[index], steps[target]] = [steps[target], steps[index]]
        const step = steps[target]
        setWorkflowEditor({ ...workflowEditor, steps })
        scheduleWorkflowStepFocus(step.id, `步骤已${direction < 0 ? '上移' : '下移'}至 ${target + 1}：${step.name || step.id}`)
      }
      function workflowStepFieldError(step, field) {
        const value = step?.[field]
        if (field === 'name' && !value?.trim()) return '步骤名称不能为空'
        if (field === 'persona' && !value?.trim()) return 'Persona 不能为空'
        if (field === 'processPrompt' && value !== '' && !value?.trim()) return 'Process Prompt 必须精确留空或包含有效内容'
        if ((field === 'persona' || field === 'processPrompt') && value?.length > 10000) return '内容超过 10000 字符限制'
        if (typeof value === 'string' && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return '内容包含不允许的控制字符'
        return ''
      }
      function workflowChangedCount() {
        if (!workflowEditor) return 0
        const baseline = workflowBaseline
        let count = ['generatorId', 'generatorName', 'description'].filter(field => workflowEditor[field] !== (baseline?.[field] ?? '')).length
        if (!baseline) return count + workflowEditor.steps.reduce((total, step) => total + 1 + ['name', 'persona', 'processPrompt'].filter(field => !!step[field]).length, 0)
        if (workflowEditor.steps.map(step => step.id).join('\n') !== baseline.steps.map(step => step.id).join('\n')) count += 1
        for (const step of workflowEditor.steps) {
          const previous = baseline.steps.find(item => item.id === step.id)
          if (!previous) { count += 1; continue }
          count += ['name', 'persona', 'processPrompt'].filter(field => step[field] !== previous[field]).length
        }
        return count
      }
      function discardWorkflowEdits() {
        if (!workflowBaseline) return
        const value = JSON.parse(JSON.stringify(workflowBaseline))
        setWorkflowEditor(value); setActiveWorkflowStepId(current => value.steps.some(step => step.id === current) ? current : value.steps[0].id)
      }
      function selectWorkflowStep(steps, index, focus = false) {
        const step = steps[index]
        if (!step) return
        setActiveWorkflowStepId(step.id)
        if (focus) document.getElementById(workflowStepTabId(step.id))?.focus()
      }
      function handleWorkflowStepKeyDown(event, steps, index) {
        let target
        if (['ArrowDown', 'ArrowRight'].includes(event.key)) target = (index + 1) % steps.length
        else if (['ArrowUp', 'ArrowLeft'].includes(event.key)) target = (index - 1 + steps.length) % steps.length
        else if (event.key === 'Home') target = 0
        else if (event.key === 'End') target = steps.length - 1
        else return
        event.preventDefault(); selectWorkflowStep(steps, target, true)
      }
      function workflowInvalid() {
        return !workflowEditor || !/^[a-zA-Z0-9_-]{1,128}$/.test(workflowEditor.generatorId) || !workflowEditor.generatorName.trim()
          || workflowEditor.steps.length < 1 || workflowEditor.steps.length > 8
          || new Set(workflowEditor.steps.map(step => step.id)).size !== workflowEditor.steps.length
          || workflowEditor.steps.some(step => ['name', 'persona', 'processPrompt'].some(field => !!workflowStepFieldError(step, field)))
      }
      async function saveWorkflow() {
        const adoptingLegacy = workflowBaseline?.kind === 'legacy-v1'
        if (workflowInvalid() || (!workflowDirty() && !adoptingLegacy)) return
        const creating = !workflowBaseline
        const body = { ...workflowContent(workflowEditor), ...(creating ? {} : { expected: workflowBaseline.expected }) }
        const value = await run('workflows:save', async signal => {
          try { return await api('/generator-workflows', { method: creating ? 'POST' : 'PUT', body, signal }) }
          catch (error) { if (error?.status === 409) throw new Error('保存冲突：服务器版本已变化。当前编辑内容已保留，请复制后刷新；不会自动覆盖。'); throw error }
        }, creating ? '工作流生成器已创建并立即可被 Chat 发现' : '工作流已原子保存为新版本')
        if (value) await loadWorkflows(value.record.generatorId)
      }
      function previewWorkflowHistory(row) {
        if (workflowDirty() && !window.confirm('当前工作流有未保存修改。历史预览不会覆盖修改；确认打开只读历史预览？')) return
        setHistoricalWorkflow(row); setActiveWorkflowStepId(current => row.steps.some(step => step.id === current) ? current : row.steps[0]?.id || '')
      }
      function closeWorkflowHistoryPreview() {
        setHistoricalWorkflow(null)
        setActiveWorkflowStepId(current => workflowEditor?.steps.some(step => step.id === current) ? current : workflowEditor?.steps[0]?.id || '')
      }
      function editHistoricalWorkflow() {
        if (!historicalWorkflow || !workflowEditor || !workflowBaseline) return
        if (workflowDirty() && !window.confirm(`基于历史修订 ${historicalWorkflow.version} 编辑会替换当前未保存修改。确认继续？`)) return
        const historical = historicalWorkflow
        const next = { ...workflowEditor, generatorName: historical.generatorName, description: historical.description, steps: JSON.parse(JSON.stringify(historical.steps)) }
        setWorkflowEditor(next); setHistoricalWorkflow(null); setActiveWorkflowStepId(next.steps[0]?.id || '')
        setWorkflowStepAnnouncement(`已将历史修订 ${historical.version} 载入编辑器；保存后会创建新的审计记录。`)
      }
      function focusWorkflowEditor() { document.getElementById('pf-workflow-generator-name')?.focus() }
      async function rollbackWorkflow(row) {
        if (!workflowBaseline || !window.confirm(`确认回滚到修订 ${row.version} 的步骤与顺序？${workflowDirty() ? '当前未保存修改会被放弃。' : ''}系统会创建新的审计记录。`)) return
        const value = await run('workflows:rollback', signal => api('/generator-workflows/rollback', { body: { generatorId: workflowBaseline.generatorId, expected: workflowBaseline.expected, targetVersion: row.version }, signal }), `已基于修订 ${row.version} 创建回滚记录`)
        if (value) await loadWorkflows(workflowBaseline.generatorId)
      }
      async function toggleWorkflow() {
        if (!workflowBaseline || workflowBaseline.kind !== 'workflow-v1' || !confirmWorkflowDiscard()
          || !window.confirm(`${workflowBaseline.enabled ? '归档' : '启用'}生成器 ${workflowBaseline.generatorName}？`)) return
        const action = workflowBaseline.enabled ? 'disable' : 'enable'
        const value = await run(`workflows:${action}`, signal => api(`/generator-workflows/${action}`, { body: { generatorId: workflowBaseline.generatorId, expected: workflowBaseline.expected }, signal }), workflowBaseline.enabled ? '生成器已归档，新请求不可发现' : '生成器已启用')
        if (value) await loadWorkflows(workflowBaseline.generatorId)
      }
      async function requestWorkflowDeletePreview(record) {
        const controller = new AbortController()
        activeController.current?.abort(); activeController.current = controller; setBusy('workflows:delete-preview')
        try {
          const value = await api('/generator-workflows/delete/preview', { body: { generatorId: record.generatorId, expected: record.expected }, signal: controller.signal })
          setWorkflowDeleteDialog(current => current ? { ...current, preview: value, error: '' } : current)
        } catch (error) {
          if (!controller.signal.aborted && (error?.status === 409 || error?.status === 410)) {
            setWorkflowDeleteDialog(null)
            await loadWorkflows(record.generatorId).catch(() => loadWorkflows())
            setNotice({ type: 'error', text: '生成器版本已经变化，已重新加载当前版本。请检查后重新发起删除。' })
            window.requestAnimationFrame(() => workflowSelectorRef.current?.focus?.())
          } else if (!controller.signal.aborted) {
            setWorkflowDeleteDialog(current => current ? { ...current, preview: null, error: error?.message || '删除预检失败，请刷新后重试。' } : current)
          }
        } finally {
          if (activeController.current === controller) { activeController.current = null; setBusy('') }
        }
      }
      function openWorkflowDelete() {
        if (!workflowBaseline || workflowBaseline.kind !== 'workflow-v1' || workflowBaseline.enabled || workflowBaseline.lifecycle === 'deleted' || historicalWorkflow) return
        workflowDeleteOpenerRef.current = document.activeElement
        setWorkflowDeleteDialog({ record: JSON.parse(JSON.stringify(workflowBaseline)), typedId: '', preview: null, error: '', submitting: false, dirty: workflowDirty() })
        void requestWorkflowDeletePreview(workflowBaseline)
      }
      function closeWorkflowDelete() {
        if (workflowDeleteDialog?.submitting) return
        setWorkflowDeleteDialog(null)
        window.requestAnimationFrame(() => workflowDeleteOpenerRef.current?.focus?.())
      }
      function handleWorkflowDeleteKeyDown(event) {
        if (event.key === 'Escape') { event.preventDefault(); closeWorkflowDelete(); return }
        if (event.key !== 'Tab') return
        const controls = event.currentTarget.querySelectorAll?.('button:not(:disabled),input:not(:disabled)') ?? []
        if (!controls.length) return
        const first = controls[0]; const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
      async function commitWorkflowDelete() {
        const dialog = workflowDeleteDialog
        if (!dialog || dialog.submitting || dialog.typedId !== dialog.record.generatorId || !dialog.preview?.canDelete) return
        setWorkflowDeleteDialog(current => current ? { ...current, submitting: true, error: '' } : current)
        const controller = new AbortController(); activeController.current?.abort(); activeController.current = controller; setBusy('workflows:delete')
        try {
          await api('/generator-workflows/delete', { body: { generatorId: dialog.record.generatorId, expected: dialog.record.expected }, signal: controller.signal })
          setWorkflowDeleteDialog(null); setNotice({ type: 'success', text: '工作流生成器已永久删除；其 ID 永久保留。' })
          await loadWorkflows()
          window.requestAnimationFrame(() => workflowSelectorRef.current?.focus?.())
        } catch (error) {
          if (!controller.signal.aborted && (error?.status === 409 || error?.status === 410)) {
            setWorkflowDeleteDialog(null)
            await loadWorkflows(dialog.record.generatorId).catch(() => loadWorkflows())
            setNotice({ type: 'error', text: '删除未执行：生成器版本已经变化，已重新加载当前版本。请检查后重新发起删除。' })
            window.requestAnimationFrame(() => workflowSelectorRef.current?.focus?.())
          } else if (!controller.signal.aborted) {
            setWorkflowDeleteDialog(current => current ? { ...current, submitting: false, preview: null, error: error?.message || '删除失败。' } : current)
          }
        } finally {
          if (activeController.current === controller) { activeController.current = null; setBusy('') }
        }
      }
      function workflowDeleteDialogView() {
        const dialog = workflowDeleteDialog
        if (!dialog) return null
        const blockers = dialog.preview?.blockers ?? { pending: 0, running: 0 }
        const ready = dialog.preview?.canDelete === true && dialog.typedId === dialog.record.generatorId && !dialog.submitting
        return h('div', { className: 'pf-destructive-overlay', role: 'presentation' },
          h('section', { className: 'pf-destructive-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pf-delete-workflow-title', onKeyDown: handleWorkflowDeleteKeyDown },
            h('h2', { id: 'pf-delete-workflow-title' }, '删除生成器'),
            h('p', null, `即将永久删除 ${dialog.record.generatorName}。此操作没有 Dashboard 恢复入口。`),
            h('p', { className: 'pf-code' }, `ID: ${dialog.record.generatorId}\n版本: ${dialog.record.version}\nSHA-256: ${dialog.record.sha256}`),
            dialog.dirty ? h('div', { className: 'pf-notice pf-notice-error' }, '警告：当前有未保存修改；这些修改不会进入审计历史，并会随删除操作丢弃。') : null,
            h('ul', null,
              h('li', null, '此 ID 永远不能复用。'),
              h('li', null, 'Builder 与 Chat 的正常发现会隐藏此生成器。'),
              h('li', null, 'Generation Requests、工作流审计历史与 Prompt 兼容记录会保留。'),
              h('li', null, '旧的可重试请求仍可使用其固定快照与原始运行时重试。')),
            h('p', null, `阻塞请求：pending ${blockers.pending}，running ${blockers.running}`),
            dialog.error ? h('div', { className: 'pf-notice pf-notice-error', role: 'alert' }, dialog.error) : null,
            h(Field, { label: `输入完整 ID “${dialog.record.generatorId}” 以确认`, value: dialog.typedId, disabled: dialog.submitting,
              onChange: value => setWorkflowDeleteDialog(current => current ? { ...current, typedId: value } : current) }),
            h('div', { className: 'pf-actions' },
              h(Button, { buttonRef: workflowDeleteCancelRef, onClick: closeWorkflowDelete, disabled: dialog.submitting }, '取消'),
              h(Button, { onClick: () => requestWorkflowDeletePreview(dialog.record), disabled: dialog.submitting || !!busy }, '刷新预检'),
              h(Button, { danger: true, onClick: commitWorkflowDelete, disabled: !ready }, dialog.submitting ? '正在永久删除…' : '永久删除生成器'))))
      }
      function workflowBuilderView() {
        if (!status?.services.generatorWorkflows) return h(Empty, null, '工作流生成器未启用。旧版提示词历史仅作为后端只读数据保留，不提供 Dashboard 编辑入口。请由部署者启用 prismflow-store-generator-workflows 与 Builder Profile 后再迁移。')
        const editor = historicalWorkflow ?? workflowEditor
        const activeIndex = editor ? Math.max(0, editor.steps.findIndex(step => step.id === activeWorkflowStepId)) : -1
        const activeStep = activeIndex >= 0 ? editor.steps[activeIndex] : null
        const activeTabId = activeStep ? workflowStepTabId(activeStep.id) : undefined
        const changedCount = workflowChangedCount()
        const workflowStatus = historicalWorkflow
          ? `只读历史修订 ${historicalWorkflow.version}`
          : workflowInvalid() ? `已修改 ${changedCount} 项 · 请修正验证错误`
            : workflowBaseline?.kind === 'legacy-v1' ? `旧版生成器 · ${changedCount ? `已修改 ${changedCount} 项 · ` : ''}尚未迁移`
              : workflowDirty() ? `已修改 ${changedCount} 项 · 待原子保存`
                : workflowBaseline ? '已保存 · 当前内容与生效版本一致' : `新工作流 · 已填写 ${changedCount} 项`
        const workflowStateBadge = historicalWorkflow
          ? `历史修订 ${historicalWorkflow.version}`
          : workflowInvalid() ? `需修正 · ${changedCount} 项修改`
            : workflowBaseline?.kind === 'legacy-v1' ? changedCount ? `待迁移 · ${changedCount} 项修改` : '待迁移'
              : workflowDirty() ? `未保存 · ${changedCount} 项修改` : '已保存'
        return h(React.Fragment, null,
          h('div', { className: 'pf-workflow-page' },
            h('h2', { className: 'pf-section-title' }, '工作流生成器 Builder'),
            h('p', { className: 'pf-section-help' }, '现有工作流可直接编辑名称、说明、步骤顺序、Persona 和 Process Prompt，并以 CAS 原子保存为新版本。逻辑 ID 及 Provider、模型、工具、安全包装和执行上限由部署固定。'),
            h('div', { className: 'pf-sr-only pf-workflow-step-announcement', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, workflowStepAnnouncement),
            h('div', { className: 'pf-workflow-topbar' },
              h(Field, { label: '工作流生成器', controlRef: workflowSelectorRef, value: workflowBaseline?.generatorId || '', options: [{ value: '', label: '选择生成器' }, ...workflowCatalog.map(item => ({ value: item.generatorId, label: `${item.generatorName} (${item.generatorId})${item.kind === 'legacy-v1' ? ' · 旧版待迁移' : item.enabled ? '' : ' · 已归档'}` }))], disabled: !!busy, onChange: selectWorkflow }),
              h('div', { className: 'pf-actions' },
                workflowEditor && !historicalWorkflow ? h(Button, { primary: true, onClick: focusWorkflowEditor, disabled: !!busy, 'aria-label': `编辑当前工作流：${workflowEditor.generatorName || workflowEditor.generatorId || '未命名'}` }, '编辑当前工作流') : null,
                h(Button, { onClick: newWorkflow, disabled: !!busy, 'aria-label': '新建工作流生成器' }, '新建逻辑生成器'),
                h(Button, { onClick: () => confirmWorkflowDiscard() && loadWorkflows(workflowBaseline?.generatorId), disabled: !!busy, 'aria-label': `刷新工作流生成器${workflowBaseline?.generatorName ? `：${workflowBaseline.generatorName}` : '列表'}` }, '刷新'))),
            editor ? h(React.Fragment, null,
              historicalWorkflow ? h('div', { className: 'pf-notice', role: 'status' }, `正在只读预览历史修订 ${historicalWorkflow.version}，步骤与顺序均来自该历史行；当前未保存编辑仍保留。`) : null,
              !historicalWorkflow && workflowBaseline?.kind === 'legacy-v1' ? h('div', { className: 'pf-notice', role: 'status' },
                h('strong', null, '旧版生成器 · 尚未迁移'),
                '。当前内容来自内部只读旧版提示词历史；可先检查或调整步骤，再通过精确修订号与 SHA-256 CAS 迁移为当前工作流格式。迁移不会改写旧行、哈希或已固定的 Generation Request。') : null,
              h('section', { className: 'pf-workflow-meta', 'aria-label': '生成器基本信息' },
                h('div', { className: 'pf-workflow-meta-head' },
                  h('h3', null, '生成器信息'),
                  h('span', { className: `pf-badge pf-workflow-state-badge${!historicalWorkflow && !workflowInvalid() && !workflowDirty() && workflowBaseline?.kind !== 'legacy-v1' ? ' pf-ok' : ''}`, 'aria-label': `编辑状态：${workflowStateBadge}` }, workflowStateBadge)),
                h('div', { className: 'pf-workflow-meta-grid' },
                  h(Field, { className: 'pf-workflow-id', label: '生成器逻辑 ID', value: editor.generatorId, readOnly: !!workflowBaseline, disabled: !!historicalWorkflow, onChange: value => updateWorkflow('generatorId', value) }),
                  h(Field, { id: 'pf-workflow-generator-name', label: '生成器名称', value: editor.generatorName, disabled: !!historicalWorkflow, onChange: value => updateWorkflow('generatorName', value) }),
                  h(Field, { label: '生成器说明', value: editor.description, disabled: !!historicalWorkflow, onChange: value => updateWorkflow('description', value) })),
                editor.deploymentPolicy
                  ? h('details', { className: 'pf-workflow-policy' }, h('summary', null, h('span', { className: 'pf-badge' }, '部署只读'), '查看固定执行策略'), h('pre', { className: 'pf-code' }, JSON.stringify(editor.deploymentPolicy, null, 2)))
                  : h('div', { className: 'pf-workflow-policy' }, h('span', { className: 'pf-badge' }, '创建后附加部署策略'), ' 请求不能提交执行策略。')),
              h('div', { className: 'pf-workflow-canvas' },
                h('aside', { className: 'pf-workflow-rail', 'aria-label': '工作流步骤导航' },
                  h('div', { className: 'pf-workflow-rail-head' }, h('h3', null, '串行步骤'), h('span', { className: 'pf-badge' }, `${editor.steps.length} / 8`)),
                  h('div', { className: 'pf-step-list', role: 'tablist', 'aria-label': '串行工作流步骤', 'aria-orientation': 'vertical' },
                    editor.steps.map((step, index) => h(React.Fragment, { key: step.id },
                      h('button', {
                        type: 'button', id: workflowStepTabId(step.id), className: `pf-step-tab${index === activeIndex ? ' pf-step-tab-on' : ''}`,
                        role: 'tab', tabIndex: index === activeIndex ? 0 : -1, 'aria-selected': index === activeIndex,
                        'aria-controls': 'pf-workflow-active-step-panel', 'aria-posinset': index + 1, 'aria-setsize': editor.steps.length,
                        onClick: () => selectWorkflowStep(editor.steps, index), onKeyDown: event => handleWorkflowStepKeyDown(event, editor.steps, index),
                      },
                      h('span', { className: 'pf-step-number', 'aria-hidden': true }, index + 1),
                      h('span', { className: 'pf-step-summary' }, h('strong', null, step.name || step.id), h('small', null, step.id)),
                      h('span', { className: 'pf-step-prompt-state' }, step.processPrompt === '' ? '任务说明：系统回退' : '任务说明：已自定义')),
                      index < editor.steps.length - 1 ? h('span', { className: 'pf-step-connector', 'aria-hidden': true }, '↓') : null))),
                  !historicalWorkflow ? h(Button, { className: 'pf-workflow-add', onClick: () => addWorkflowStep(), disabled: !!busy || editor.steps.length >= 8, 'aria-label': `为生成器 ${editor.generatorName || editor.generatorId || '未命名'} 添加步骤` }, '添加步骤') : null),
                activeStep ? h('section', { className: 'pf-workflow-editor', id: 'pf-workflow-active-step-panel', role: 'tabpanel', 'aria-labelledby': activeTabId },
                  h('div', { className: 'pf-workflow-editor-head' },
                    h('div', { className: 'pf-workflow-editor-title' }, h('h3', null, `${activeIndex + 1}. ${activeStep.name || activeStep.id}`), h('p', null, `稳定 ID（自动生成）：${activeStep.id}`)),
                    !historicalWorkflow ? h('div', { className: 'pf-workflow-toolbar', 'aria-label': `步骤 ${activeIndex + 1} 操作` },
                      h(Button, { onClick: () => moveWorkflowStep(activeIndex, -1), disabled: activeIndex === 0 || !!busy, 'aria-label': `上移步骤 ${activeIndex + 1}：${activeStep.name || activeStep.id}` }, '上移'),
                      h(Button, { onClick: () => moveWorkflowStep(activeIndex, 1), disabled: activeIndex === editor.steps.length - 1 || !!busy, 'aria-label': `下移步骤 ${activeIndex + 1}：${activeStep.name || activeStep.id}` }, '下移'),
                      h(Button, { onClick: () => addWorkflowStep(activeIndex), disabled: editor.steps.length >= 8 || !!busy, 'aria-label': `复制步骤 ${activeIndex + 1}：${activeStep.name || activeStep.id}` }, '复制'),
                      h(Button, { danger: true, onClick: () => removeWorkflowStep(activeIndex), disabled: editor.steps.length <= 1 || !!busy, 'aria-label': `移除步骤 ${activeIndex + 1}：${activeStep.name || activeStep.id}` }, '移除')) : null),
                  h('div', { className: 'pf-workflow-step-name' },
                    h(Field, { label: `步骤 ${activeIndex + 1} 名称`, value: activeStep.name, disabled: !!historicalWorkflow, 'aria-describedby': workflowStepFieldError(activeStep, 'name') ? 'pf-workflow-step-name-error' : undefined, 'aria-invalid': !!workflowStepFieldError(activeStep, 'name'), onChange: value => updateWorkflowStep(activeIndex, 'name', value) }),
                    workflowStepFieldError(activeStep, 'name') ? h('p', { className: 'pf-field-error', id: 'pf-workflow-step-name-error', role: 'alert' }, workflowStepFieldError(activeStep, 'name')) : null),
                  h(TextArea, { id: 'pf-workflow-persona', label: `步骤 ${activeIndex + 1} Persona`, value: activeStep.persona, disabled: !!historicalWorkflow, className: 'pf-workflow-textarea', error: workflowStepFieldError(activeStep, 'persona'), help: '定义此步骤的角色、职责、约束与输出要求。', onChange: value => updateWorkflowStep(activeIndex, 'persona', value) }),
                  h(TextArea, { id: 'pf-workflow-process-prompt', label: `步骤 ${activeIndex + 1} Process Prompt（可选）`, value: activeStep.processPrompt, disabled: !!historicalWorkflow, className: 'pf-workflow-process', error: workflowStepFieldError(activeStep, 'processPrompt'), help: activeIndex === 0
                    ? '精确留空时，固定回退会遵循 Persona 并将原始证据处理为结构化输出。'
                    : '精确留空时，固定回退会遵循 Persona，并依据原始证据处理上一步草稿。', onChange: value => updateWorkflowStep(activeIndex, 'processPrompt', value) })) : null),
              historicalWorkflow
                ? h('footer', { className: 'pf-workflow-actions pf-workflow-actions-preview', 'aria-label': '历史预览操作' },
                  h(Button, { onClick: closeWorkflowHistoryPreview, 'aria-label': `关闭工作流历史版本 ${historicalWorkflow.version} 预览` }, '关闭历史预览'),
                  h(Button, { primary: true, onClick: editHistoricalWorkflow, disabled: !!busy, 'aria-label': `基于工作流历史版本 ${historicalWorkflow.version} 编辑` }, '基于此版本编辑'))
                : h('footer', { className: 'pf-workflow-actions', 'aria-label': '工作流保存操作' },
                  h('div', { className: 'pf-workflow-status', role: 'status', 'aria-live': 'polite' }, workflowStatus),
                  h('div', { className: 'pf-actions' },
                    h(Button, { primary: true, onClick: saveWorkflow, disabled: !!busy || workflowInvalid() || (!workflowDirty() && workflowBaseline?.kind !== 'legacy-v1'), 'aria-label': workflowBaseline?.kind === 'legacy-v1' ? `迁移旧版生成器为工作流：${editor.generatorName || editor.generatorId || '未命名'}` : `原子保存工作流生成器：${editor.generatorName || editor.generatorId || '未命名'}` }, workflowBaseline?.kind === 'legacy-v1' ? '迁移为工作流' : workflowBaseline ? '保存工作流修改' : '创建工作流'),
                    workflowBaseline ? h(Button, { onClick: discardWorkflowEdits, disabled: !!busy || !workflowDirty(), 'aria-label': `放弃工作流生成器修改：${workflowBaseline.generatorName}` }, '放弃修改') : null)),
              workflowHistory.length ? h('section', { className: 'pf-workflow-history', 'aria-label': '工作流版本历史' },
                h('button', { type: 'button', className: 'pf-btn pf-workflow-history-toggle', 'aria-expanded': workflowHistoryExpanded, 'aria-controls': 'pf-workflow-history-panel', onClick: () => setWorkflowHistoryExpanded(value => !value) },
                  h('span', null, '版本历史（最新 50 个）'), h('span', { 'aria-hidden': true }, workflowHistoryExpanded ? '−' : '+')),
                workflowHistoryExpanded ? h('div', { className: 'pf-workflow-history-panel', id: 'pf-workflow-history-panel' }, workflowHistory.map(row => h('div', { className: 'pf-row pf-space pf-workflow-history-row', key: row.version },
                  h('span', { className: 'pf-code' }, `修订 ${row.version} · ${row.action} · ${row.sha256}`), h('div', { className: 'pf-actions' },
                    h(Button, { onClick: () => previewWorkflowHistory(row), 'aria-label': `预览工作流版本 ${row.version}` }, '预览'),
                    row.version < workflowBaseline.version ? h(Button, { onClick: () => rollbackWorkflow(row), disabled: !!busy, 'aria-label': `回滚工作流到版本 ${row.version}` }, '回滚') : null)))) : null) : null,
              !historicalWorkflow && workflowBaseline?.kind === 'workflow-v1' ? h('section', { className: 'pf-workflow-management', 'aria-label': '生成器状态管理' },
                h('div', { className: 'pf-row pf-space' },
                  h('div', null, h('h3', null, '生成器状态'), h('p', null, workflowBaseline.enabled ? '当前已启用，可被新的生成请求发现。' : '当前已归档，新请求不可发现。')),
                  h('div', { className: 'pf-actions' },
                    h(Button, { danger: workflowBaseline.enabled, onClick: toggleWorkflow, disabled: !!busy, 'aria-label': `${workflowBaseline.enabled ? '归档' : '重新启用'}工作流生成器：${workflowBaseline.generatorName}` }, workflowBaseline.enabled ? '归档生成器' : '重新启用'),
                    !workflowBaseline.enabled && !workflowDirty() ? h(Button, { danger: true, onClick: openWorkflowDelete, disabled: !!busy, 'aria-label': `删除生成器：${workflowBaseline.generatorName}` }, '删除生成器') : null)))
                : null)
              : h(Empty, null, '没有工作流定义。部署者配置 Builder Profile 后可新建；已有生成器可在此采用。')),
          workflowDeleteDialogView())
      }

      function switchDashboardTab(nextTab) {
        if (nextTab === tab) return
        if (tab === 'workflows' && !confirmWorkflowDiscard()) return
        setNotice(null)
        setTab(nextTab)
      }
      const guardDashboardClose = React.useCallback(() => confirmWorkflowDiscard(), [workflowEditor, workflowBaseline])
      React.useEffect(() => controller?.setCloseGuard(guardDashboardClose), [controller, guardDashboardClose])
      React.useEffect(() => {
        if (tab !== 'workflows') return undefined
        const saveWorkflowShortcut = event => {
          const adoptingLegacy = workflowBaseline?.kind === 'legacy-v1'
          if (event.repeat || event.altKey || event.shiftKey || (!event.ctrlKey && !event.metaKey) || String(event.key).toLowerCase() !== 's'
            || historicalWorkflow || busy || workflowInvalid() || (!workflowDirty() && !adoptingLegacy)) return
          event.preventDefault()
          void saveWorkflow()
        }
        window.addEventListener?.('keydown', saveWorkflowShortcut)
        return () => window.removeEventListener?.('keydown', saveWorkflowShortcut)
      }, [tab, busy, workflowEditor, workflowBaseline, historicalWorkflow])
      React.useEffect(() => {
        if (!workflowDirty()) return undefined
        const preventWorkflowUnload = event => {
          event.preventDefault()
          event.returnValue = ''
        }
        window.addEventListener?.('beforeunload', preventWorkflowUnload)
        return () => window.removeEventListener?.('beforeunload', preventWorkflowUnload)
      }, [workflowEditor, workflowBaseline])
      function editorForDraft(draft) {
        return draftEditors[draft.draftId] ?? { title: draft.title, markdown: draft.markdown }
      }
      function draftDirty(draft) {
        const editor = editorForDraft(draft)
        return editor.title !== draft.title || editor.markdown !== draft.markdown
      }
      function editDraftField(draftId, field, value) {
        const baseline = drafts.find(draft => draft.draftId === draftId)
        setDraftEditors(current => ({
          ...current,
          [draftId]: { ...(current[draftId] ?? { title: baseline?.title ?? '', markdown: baseline?.markdown ?? '' }), [field]: value },
        }))
      }
      function draftEditorInvalid(editor) {
        return !editor.title.trim() || editor.title.length > 300 || /[\u0000-\u001f\u007f]/u.test(editor.title)
          || !editor.markdown.trim() || editor.markdown.length > 100000
          || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(editor.markdown)
      }
      async function saveDraftRevision(draft) {
        const editor = editorForDraft(draft)
        if (!['draft', 'rejected'].includes(draft.status) || !draftDirty(draft) || draftEditorInvalid(editor)) return
        const value = await run(`review:save:${draft.draftId}`, async signal => {
          try {
            return await api('/production/revise', { method: 'PUT', body: {
              draftId: draft.draftId, expectedVersion: draft.version, expectedSha256: draft.sha256,
              title: editor.title, markdown: editor.markdown,
            }, signal })
          } catch (error) {
            if (error?.status === 409) throw new Error(`保存冲突：服务器草稿已变化。你的修改仍保留在编辑器中；请复制修改或刷新后重新应用。${error.message ? ` ${error.message}` : ''}`)
            throw error
          }
        }, '草稿修改已保存为新的待审核版本')
        if (value) {
          setDrafts(current => current.map(item => item.draftId === draft.draftId ? value.draft : item))
          setDraftEditors(current => ({ ...current, [draft.draftId]: { title: value.draft.title, markdown: value.draft.markdown } }))
        }
      }
      async function refreshReview() {
        if (drafts.some(draft => draftDirty(draft)) && !window.confirm('刷新会放弃所有未保存的草稿修改，是否继续？')) return
        await loadReview({ resetEditors: true, queryState: draftQuery })
      }
      async function queryDraftPage(next) {
        if (drafts.some(draft => draftDirty(draft)) && !window.confirm('切换筛选或分页会放弃未保存的草稿修改，是否继续？')) return
        setDraftQuery(next); setExpandedDrafts({}); setPublicationFeedback(null)
        await loadReview({ resetEditors: true, queryState: next })
      }
      async function applyDraftFilters() { await queryDraftPage({ ...draftQuery, page: 1 }) }
      async function resetDraftFilters() { await queryDraftPage({ status: '', query: '', page: 1, pageSize: draftQuery.pageSize }) }
      async function toggleRssOutput(outputId) {
        if (rssOutputDetails[outputId]) {
          setRssOutputDetails(current => { const next = { ...current }; delete next[outputId]; return next })
          return
        }
        const value = await run(`rss-output:${outputId}`, signal => api(`/production/rss-output?outputId=${encodeURIComponent(outputId)}`, { signal }))
        if (value?.record) setRssOutputDetails(current => ({ ...current, [outputId]: value.record }))
      }
      async function reviewDraft(draft, decision) {
        if (draftDirty(draft)) { setNotice({ type: 'error', text: '请先保存或放弃当前修改，再执行审批。' }); return }
        const value = await run(`review:${decision}`, async signal => {
          try {
            return await api('/production/review', { body: {
              draftId: draft.draftId, decision, version: draft.version, sha256: draft.sha256,
            }, signal })
          } catch (error) {
            if (error?.status !== 409) throw error
            const fresh = await api(`/production/draft?draftId=${encodeURIComponent(draft.draftId)}`, { signal })
            setDrafts(current => current.map(item => item.draftId === draft.draftId ? fresh.draft : item))
            setDraftEditors(current => ({ ...current, [draft.draftId]: { title: fresh.draft.title, markdown: fresh.draft.markdown } }))
            throw new Error('审批冲突：已刷新并显示服务器上的版本与哈希。请核对新内容后再次点击审批。')
          }
        }, decision === 'approve' ? '草稿已按显示的版本和哈希批准' : '草稿已按显示的版本和哈希拒绝')
        if (value) {
          setDrafts(current => current.map(item => item.draftId === draft.draftId ? value.draft : item))
          setDraftEditors(current => ({ ...current, [draft.draftId]: { title: value.draft.title, markdown: value.draft.markdown } }))
        }
      }
      async function deleteDraft(draft) {
        if (!['draft', 'rejected', 'approved', 'published'].includes(draft.status)) return
        if (draftDirty(draft)) { setNotice({ type: 'error', text: '请先保存或放弃当前修改，再删除草稿。' }); return }
        const deletionWarning = draft.status === 'published'
          ? '这只会删除 PrismFlow 本地草稿；已经写入外部平台的内容不会被撤回。发布回执、Generation Request 和来源审计仍会保留。'
          : draft.status === 'approved'
            ? '删除后该已审批 Artifact 将不能再发布。Generation Request、审批来源和审计记录仍会保留。'
            : '历史 Generation Request 和审计来源仍会保留。'
        if (!window.confirm(`永久从草稿列表中删除这份${draftStatus(draft.status).label}草稿？\n\n标题：${draft.title}\nDraft ID：${draft.draftId}\n版本：${draft.version}\nSHA-256：${draft.sha256}\n\n${deletionWarning}\n草稿删除后不能恢复。`)) return
        const value = await run(`review:delete:${draft.draftId}`, async signal => {
          try {
            return await api('/production/delete-draft', { body: {
              draftId: draft.draftId, expectedVersion: draft.version, expectedSha256: draft.sha256,
            }, signal })
          } catch (error) {
            if (error?.status !== 409) throw error
            try {
              const fresh = await api(`/production/draft?draftId=${encodeURIComponent(draft.draftId)}`, { signal })
              setDrafts(current => current.map(item => item.draftId === draft.draftId ? fresh.draft : item))
              setDraftEditors(current => ({ ...current, [draft.draftId]: { title: fresh.draft.title, markdown: fresh.draft.markdown } }))
              throw new Error('删除冲突：已刷新服务器上的草稿版本。请核对后再次删除。')
            } catch (refreshError) {
              if (refreshError?.status === 404) return { deletion: { draftId: draft.draftId, replay: true } }
              throw refreshError
            }
          }
        }, '草稿已从审核列表中删除；Generation Request 与来源审计仍然保留')
        if (value) {
          setDrafts(current => current.filter(item => item.draftId !== draft.draftId))
          setDraftEditors(current => { const next = { ...current }; delete next[draft.draftId]; return next })
          setExpandedDrafts(current => { const next = { ...current }; delete next[draft.draftId]; delete next[`preview:${draft.draftId}`]; return next })
        }
      }
      async function reconcileWechatCommitted(draft, attempt) {
        if (!attempt || attempt.state !== 'reconciliation-required' || !attempt.publisherId?.startsWith('wechat-draft:')) return
        const confirmed = window.confirm(`仅在已登录微信公众号后台并确认草稿箱中存在本次创建的文章后继续。\n\n标题：${draft.title}\n对账记录：第 ${attempt.attemptNumber} 次发布（${attempt.attemptId.slice(-8)}）\n\n系统将自动绑定当前受阻的精确 Attempt，并写入“操作员确认、未自动验证”的审计回执。是否记录成功？`)
        if (!confirmed) return
        const value = await run(`review:reconcile-committed:${attempt.attemptId}`, signal => api('/production/reconcile-committed', { body: {
          draftId: draft.draftId, publisherId: attempt.publisherId, attemptId: attempt.attemptId,
          confirmation: 'external-destination-checked-committed',
        }, signal }), '已按操作员核对结果记录微信公众号草稿创建成功；审计回执标记为未自动验证')
        if (value) { setPublicationFeedback({ draftId: draft.draftId, type: 'ok', text: '微信公众号草稿已由操作员核对并记录为发布成功。' }); await loadReview() }
      }
      async function reconcileWechatAbsent(draft, attempt) {
        if (!attempt || attempt.state !== 'reconciliation-required' || !attempt.publisherId?.startsWith('wechat-draft:')) return
        const confirmed = window.confirm(`仅在已登录微信公众号后台并确认草稿箱不存在本次创建的文章后继续。\n\n标题：${draft.title}\n对账记录：第 ${attempt.attemptNumber} 次发布（${attempt.attemptId.slice(-8)}）\n\n系统将自动绑定当前受阻的精确 Attempt。是否确认外部草稿不存在？`)
        if (!confirmed) return
        const value = await run(`review:reconcile:${attempt.attemptId}`, signal => api('/production/reconcile-not-committed', { body: {
          draftId: draft.draftId, publisherId: attempt.publisherId, attemptId: attempt.attemptId,
          confirmation: 'external-destination-checked-absent',
        }, signal }), '已按“微信公众号草稿不存在”完成精确对账；稿件已恢复到发布前状态')
        if (value) await loadReview()
      }
      async function publishDraft(draft, publisher) {
        if (drafts.some(item => draftDirty(item))) {
          const text = '存在未保存的草稿修改。为避免丢失任何草稿编辑，请先保存或放弃全部修改，再执行发布。'
          setNotice({ type: 'error', text }); setPublicationFeedback({ draftId: draft.draftId, type: 'error', text })
          return
        }
        const readiness = publisherReadiness(draft, publisher)
        if (!readiness.ready) {
          setNotice({ type: 'error', text: readiness.reason }); setPublicationFeedback({ draftId: draft.draftId, type: 'error', text: readiness.reason })
          return
        }
        const repeat = draft.publishedPublisherIds?.includes(publisher.id) === true
        if (repeat && !window.confirm(`确认再次发布并创建独立的远程草稿/发布？\n发布器：${publisher.name} (${publisher.id})\nDraft ID：${draft.draftId}\n版本：${draft.version}\nSHA-256：${draft.sha256}\n\n此操作与现有远程草稿分离，会再次调用目标，且不会自动重试发布器。`)) return
        const intentId = repeat ? window.crypto.randomUUID().toLowerCase() : undefined
        const requestBody = repeat
          ? { draftId: draft.draftId, publisherId: publisher.id, expectedVersion: draft.version, expectedSha256: draft.sha256, intentId }
          : { draftId: draft.draftId, publisherId: publisher.id }
        const target = publisherPresentation(publisher)
        setPublishingTargetId(publisher.id)
        setPublicationFeedback({ draftId: draft.draftId, type: 'info', text: `正在发布到${target.channel}：${target.name}…` })
        let publicationError
        const value = await run('review:publish', async signal => {
          try {
            const invoke = () => api(repeat ? '/production/republish' : '/production/publish', { body: requestBody, signal })
            try { return await invoke() }
            catch (error) {
              // A repeat's durable intent token makes one transport-only replay
              // safe. HTTP responses and caller cancellation are never retried.
              if (!repeat || error instanceof ApiError || signal.aborted) throw error
              return await invoke()
            }
          } catch (error) {
            publicationError = error
            if (error?.status === 409 && error?.value?.receipt?.status === 'reconciliation-required') return error.value
            throw error
          }
        }, value => value?.receipt?.status === 'reconciliation-required' || value?.receipt?.receiptPersistence === 'failed' ? '' : '已批准稿件发布完成')
        setPublishingTargetId('')
        if (!value) {
          const operation = publicationError?.value?.operation
          const code = publicationError?.value?.code
          const reason = typeof publicationError?.value?.error === 'string' && publicationError.value.error.length <= 240 ? publicationError.value.error : ''
          const failure = operation ? `${ATTEMPT_FAILURE_LABELS[operation] ?? operation}${Number.isInteger(code) ? `（微信错误码 ${code}）` : ''}${reason ? `：${reason}` : ''}` : ''
          setPublicationFeedback({ draftId: draft.draftId, type: 'error', text: failure
            ? `发布到${target.channel}未完成：${failure}。请查看下方“发布尝试历史”；结果未知时不要连续点击。`
            : `发布到${target.channel}未完成。下方“发布尝试历史”会显示是否已提交；请勿在结果未知时连续点击。` })
          await loadReview()
          return
        }
        if (value) {
          await loadReview()
          if (value.receipt?.externalOutcome === 'unknown') {
            setNotice({ type: 'error', text: '外部发布结果未知，必须由操作员核对并完成对账；请勿重试。' })
          } else if (value.receipt?.receiptPersistence === 'failed') {
            setNotice({
              type: 'error',
              text: value.receipt.publicationCommitted
                ? '发布目标可能已写入，但持久化审计回执失败。必须先由特权操作员修复回执并完成对账，当前禁止再次发布。'
                : '发布未产生新的目标写入，但持久化审计回执失败。',
            })
          } else if (value.receipt?.status === 'reconciliation-required') {
            setNotice({ type: 'error', text: '发布需要操作员对账；请勿重试。' })
          } else {
            setPublicationFeedback({ draftId: draft.draftId, type: 'ok', text: `已发布到${target.channel}：${target.name}` })
          }
        }
      }
      function draftPresentationImageRows(draft) {
        const all = draft.destinationPresentations ?? []
        const configuredPublisherIds = new Set(publishers.map(item => item.id))
        const active = all.filter(item => configuredPublisherIds.has(item.publisherId))
        const visible = active.length ? active : all
        return visible.flatMap(item => {
          const ordered = [...new Set([item.cover?.assetId, ...(item.imageOrder ?? [])].filter(Boolean))]
          return ordered.map((assetId, index) => ({ publisherId: item.publisherId, assetId, position: index + 1, isCover: index === 0 }))
        })
      }
      function draftMediaUrl(draftId, assetId) {
        return `${API_PREFIX}/production/media?draftId=${encodeURIComponent(draftId)}&assetId=${encodeURIComponent(assetId)}`
      }
      function closePresentationMediaPreview() { setPresentationMediaPreview(null) }
      function closePresentationOriginalPreview() {
        setPresentationMediaPreview(current => current ? { ...current, original: null } : current)
      }
      function presentationMediaPreviewView() {
        if (!presentationMediaPreview) return null
        const original = presentationMediaPreview.original
        return h(React.Fragment, null,
          h('div', { className: 'pf-destructive-overlay pf-cover-overlay', role: 'presentation' },
            h('button', { type: 'button', className: 'pf-backdrop', onClick: closePresentationMediaPreview, 'aria-label': '关闭非正文图片列表' }),
            h('section', { className: 'pf-cover-dialog', role: 'dialog', 'aria-modal': original ? undefined : true, 'aria-labelledby': 'pf-presentation-media-title',
              onKeyDown: event => { if (event.key === 'Escape' && !original) closePresentationMediaPreview() } },
              h('div', { className: 'pf-cover-dialog-head' },
                h('div', null, h('h2', { id: 'pf-presentation-media-title' }, '不在正文中的图片'),
                  h('p', null, `${presentationMediaPreview.title} · 按微信上传顺序排列，第一张作为封面上传。点击图片查看原图。`)),
                h('button', { type: 'button', className: 'pf-close', onClick: closePresentationMediaPreview, 'aria-label': '关闭非正文图片列表' }, '×')),
              h('div', { className: 'pf-cover-grid' }, ...presentationMediaPreview.images.map(image => {
                const publisher = publishers.find(item => item.id === image.publisherId)
                const publisherName = publisher?.name ?? image.publisherId
                const imageUrl = draftMediaUrl(presentationMediaPreview.draftId, image.assetId)
                const imageAlt = `${publisherName} 第 ${image.position} 张非正文图片${image.isCover ? '（封面）' : ''}`
                return h('figure', { className: 'pf-cover-figure', key: `${image.publisherId}:${image.assetId}` },
                  h('button', { type: 'button', className: 'pf-cover-image-button', title: '点击查看原图', 'aria-label': `查看原图：${imageAlt}`,
                    onClick: () => setPresentationMediaPreview(current => current ? { ...current, original: { ...image, publisherName, imageUrl, imageAlt } } : current) },
                    h('img', { className: 'pf-cover-image', src: imageUrl, alt: imageAlt, referrerPolicy: 'no-referrer' })),
                  h('figcaption', null,
                    h('strong', null, `${publisherName} · 第 ${image.position} 张${image.isCover ? ' · 封面' : ' · 非封面'}`),
                    h('span', { className: 'pf-code' }, image.assetId)))
              })),
              h('div', { className: 'pf-actions' }, h(Button, { onClick: closePresentationMediaPreview }, '关闭')))),
          original ? h('div', { className: 'pf-destructive-overlay pf-original-overlay', role: 'presentation' },
            h('button', { type: 'button', className: 'pf-backdrop', onClick: closePresentationOriginalPreview, 'aria-label': '关闭原图预览' }),
            h('section', { className: 'pf-original-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pf-original-image-title',
              onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); closePresentationOriginalPreview() } } },
              h('div', { className: 'pf-original-dialog-head' },
                h('div', null, h('h2', { id: 'pf-original-image-title' }, '查看原图'),
                  h('p', null, `${original.publisherName} · 第 ${original.position} 张${original.isCover ? ' · 封面' : ''} · ${original.assetId}`)),
                h('button', { type: 'button', className: 'pf-close', onClick: closePresentationOriginalPreview, 'aria-label': '关闭原图预览' }, '×')),
              h('div', { className: 'pf-original-stage' },
                h('img', { className: 'pf-original-image', src: original.imageUrl, alt: original.imageAlt, referrerPolicy: 'no-referrer' })),
              h('div', { className: 'pf-actions' },
                h('a', { className: 'pf-btn', href: original.imageUrl, target: '_blank', rel: 'noopener noreferrer' }, '在新窗口打开'),
                h(Button, { onClick: closePresentationOriginalPreview }, '返回图片列表')))) : null)
      }
      function reviewView() {
        if (!status?.services.production) return h(Empty, null, '草稿生产服务未启用。数据获取和内容生成请在 DSH Chat 中执行。')
        const statusCounts = draftPage.statusCounts ?? {}
        const reviewSummary = [
          ['', '全部', Object.values(statusCounts).reduce((sum, value) => sum + Number(value || 0), 0)],
          ['draft', '待审核', statusCounts.draft ?? 0], ['rejected', '已拒绝', statusCounts.rejected ?? 0], ['approved', '已批准', statusCounts.approved ?? 0],
          ['publishing', '发布处理中', statusCounts.publishing ?? 0], ['published', '已发布', statusCounts.published ?? 0],
        ]
        const totalPages = Math.max(1, Math.ceil(draftPage.total / draftQuery.pageSize))
        const publishersById = new Map(publishers.map(publisher => [publisher.id, publisher]))
        return h('div', { className: 'pf-review-page' },
          h('div', { className: 'pf-review-header' },
            h('div', null, h('h2', { className: 'pf-section-title' }, '草稿审核与发布'), h('p', { className: 'pf-section-help' }, '使用筛选快速定位草稿；列表保持紧凑，每次仅展开一份草稿处理内容、审批和发布。')),
            h(Button, { onClick: refreshReview, disabled: !!busy }, '刷新')),
          h('section', { className: 'pf-review-filter-panel', 'aria-label': '草稿筛选' },
            h('form', { className: 'pf-review-filter-form', onSubmit: event => { event.preventDefault(); void applyDraftFilters() } },
              h(Field, { className: 'pf-review-search', label: '搜索', value: draftQuery.query, placeholder: '标题、Draft ID、生成器或 Request ID', onChange: query => setDraftQuery(current => ({ ...current, query })) }),
              h(Field, { className: 'pf-review-status-filter', label: '状态', value: draftQuery.status, options: reviewSummary.map(([value, label]) => ({ value, label })), onChange: status => setDraftQuery(current => ({ ...current, status })) }),
              h(Field, { className: 'pf-review-page-size', label: '每页', value: String(draftQuery.pageSize), options: [10, 20, 50].map(value => ({ value: String(value), label: `${value} 条` })), onChange: value => setDraftQuery(current => ({ ...current, pageSize: Number(value) })) }),
              h('div', { className: 'pf-review-filter-actions' }, h(Button, { primary: true, onClick: applyDraftFilters, disabled: !!busy }, '查询'), h(Button, { onClick: resetDraftFilters, disabled: !!busy || (!draftQuery.status && !draftQuery.query) }, '重置'))),
            h('div', { className: 'pf-review-status-chips', role: 'list', 'aria-label': '按状态快速筛选' }, ...reviewSummary.map(([value, label, count]) => h('button', { type: 'button', key: value || 'all', className: `pf-review-status-chip${draftQuery.status === value ? ' pf-review-status-chip-on' : ''}`, disabled: !!busy, onClick: () => queryDraftPage({ ...draftQuery, status: value, page: 1 }) }, h('span', null, label), h('strong', null, String(count))))),
            h('div', { className: 'pf-review-toolbar' }, h('span', { className: 'pf-muted' }, `找到 ${draftPage.total} 份草稿 · 第 ${draftQuery.page} / ${totalPages} 页`), h('span', { className: 'pf-muted' }, '默认按创建时间从新到旧'))),
          drafts.some(draft => draftDirty(draft)) ? h('div', { className: 'pf-notice pf-notice-error' }, '存在未保存的草稿修改；发布已阻止。请先保存或放弃全部草稿修改。') : null,
          drafts.length ? h('div', { className: 'pf-review-list' }, drafts.map((draft, draftIndex) => {
            const editor = editorForDraft(draft)
            const editable = ['draft', 'rejected'].includes(draft.status)
            const deletable = ['draft', 'rejected', 'approved', 'published'].includes(draft.status)
            const dirty = draftDirty(draft)
            const invalid = draftEditorInvalid(editor)
            const expanded = expandedDrafts[draft.draftId] === true
            const previewExpanded = expandedDrafts[`preview:${draft.draftId}`] === true
            const titleInputId = `pf-draft-title-${draftIndex}`
            const markdownInputId = `pf-draft-markdown-${draftIndex}`
            const previewLabelId = `pf-draft-preview-label-${draftIndex}`
            const draftTitleId = `pf-draft-title-label-${draftIndex}`
            const state = draftStatus(draft.status)
            const draftRssOutputs = rssOutputs.filter(output => output.draftId === draft.draftId)
            const presentationImages = draftPresentationImageRows(draft)
            const hasNewspicPresentation = draft.destinationPresentations?.some(item => publishers.some(publisher => publisher.id === item.publisherId && publisher.articleType === 'newspic')) === true
            const reconciliationAttempt = draft.reconciliationRequired
              ? draft.publicationAttempts?.find(attempt => attempt.state === 'reconciliation-required' && attempt.publisherId?.startsWith('wechat-draft:'))
              : undefined
            return h('article', { className: `pf-card pf-draft-card pf-draft-status-${draft.status}${expanded ? ' pf-draft-card-expanded' : ''}`, key: draft.draftId, 'aria-labelledby': draftTitleId },
              h('div', { className: 'pf-draft-card-head' },
                h('div', { className: 'pf-draft-heading' },
                  h('div', { className: 'pf-draft-state-row' },
                    h('span', { className: `pf-badge pf-draft-status pf-draft-status-${draft.status}-badge` }, state.label),
                    dirty ? h('span', { className: 'pf-badge pf-draft-dirty' }, '有未保存修改') : null,
                    draft.reconciliationRequired ? h('span', { className: 'pf-badge pf-draft-dirty' }, '需要人工对账') : null),
                  h('h3', { id: draftTitleId, className: 'pf-draft-title' }, editor.title || '(无标题)')),
                h('div', { className: 'pf-actions pf-draft-head-actions' },
                  presentationImages.length ? h(Button, { onClick: () => setPresentationMediaPreview({ draftId: draft.draftId, title: editor.title || '(无标题)', images: presentationImages }),
                    'aria-label': `查看不在正文中的图片：${editor.title || '无标题'}` }, `非正文图片 (${presentationImages.length})`) : null,
                  h('button', {
                    type: 'button', className: 'pf-btn', 'aria-expanded': expanded, 'aria-controls': `pf-draft-body-${draftIndex}`, 'aria-label': `${expanded ? '收起' : '展开'}草稿：${editor.title || '无标题'}`,
                    onClick: () => setExpandedDrafts(current => current[draft.draftId] === true ? {} : { [draft.draftId]: true }),
                  }, expanded ? '收起' : '展开'))),
              h('div', { className: 'pf-draft-meta' },
                h('span', { className: 'pf-draft-meta-item' }, '生成器：', h('strong', null, draft.generatorId)),
                h('span', { className: 'pf-draft-meta-item' }, '更新时间：', h('strong', null, displayDraftTime(draft.updatedAt))),
                draft.publishedPublisherIds?.length ? h('span', { className: 'pf-draft-meta-item' }, '已发布渠道：', h('strong', null, String(draft.publishedPublisherIds.length))) : null),
              expanded ? h('p', { className: 'pf-code pf-draft-technical' }, `${draft.draftId} · 修订 ${draft.version} · SHA-256 ${draft.sha256}`) : null,
              draft.reconciliationRequired ? h('div', { className: 'pf-notice pf-notice-error', style: { margin: '14px 20px 0' } },
                h('p', null, 'DSH 未收到可确认的最终响应；本地“需要对账”状态不代表微信公众号创建失败。请登录公众号后台核对本次文章，确认前不要重试。'),
                reconciliationAttempt ? h('div', { className: 'pf-actions' },
                  h('button', { type: 'button', className: 'pf-btn pf-primary', disabled: !!busy,
                    onClick: () => reconcileWechatCommitted(draft, reconciliationAttempt) }, '已核对：草稿存在，记录成功'),
                  h('button', { type: 'button', className: 'pf-btn pf-danger', disabled: !!busy,
                    onClick: () => reconcileWechatAbsent(draft, reconciliationAttempt) }, '已核对：草稿不存在')) : null) : null,
              expanded ? h('div', { id: `pf-draft-body-${draftIndex}`, className: 'pf-draft-body' },
                h('p', { className: 'pf-code' }, draft.executionKind === 'workflow-v1'
                  ? `Workflow 修订 ${draft.generatorWorkflowVersion} · ${draft.generatorWorkflowSha256}`
                  : Number.isInteger(draft.generatorPromptVersion) ? `Prompt 修订 ${draft.generatorPromptVersion} · ${draft.generatorPromptSha256}` : 'Prompt provenance unavailable (legacy draft)'),
                !editable ? h('div', { className: 'pf-notice' }, `状态 ${draft.status} 的稿件不可编辑；如需变更必须创建新的 Generation Request。`) : null,
                draft.destinationPresentations?.length || draft.mediaAssets?.length ? h('div', { className: 'pf-notice' },
                  h('strong', null, '已绑定的发布呈现（只读）'),
                  h('p', null, `${draft.mediaAssets?.length ?? 0} 个内容寻址图片 · Artifact Binding ${draft.artifactBindingSha256 || '-'}`),
                  ...(draft.destinationPresentations ?? []).map(item => {
                    const images = presentationImages.filter(image => image.publisherId === item.publisherId)
                    const first = images[0]
                    return h('div', { key: item.publisherId, className: 'pf-row' },
                      h('span', { className: 'pf-code' }, item.publisherId),
                      h('span', null, `作者：${item.author || 'Profile 默认'} · 摘要：${item.digest || 'Profile 策略'} · 非正文图片：${images.length} 张 · 第一张作为封面`),
                      first ? h('button', { type: 'button', className: 'pf-cover-thumb-button',
                        onClick: () => setPresentationMediaPreview({ draftId: draft.draftId, title: editor.title || '(无标题)', images }), 'aria-label': '查看非正文图片列表' },
                        h('img', { src: draftMediaUrl(draft.draftId, first.assetId), alt: '非正文图片列表第一张（封面）',
                          className: 'pf-cover-thumb', referrerPolicy: 'no-referrer' })) : null)
                  })) : null,
                h('div', { className: 'pf-draft-section-head' },
                  h('strong', null, '内容编辑'),
                  h('span', null, editable ? '修改后需保存为新版本，再重新审核。' : '当前状态内容只读。')),
                h('div', { className: 'pf-field' },
                  h('label', { htmlFor: titleInputId }, '标题'),
                  h('input', { id: titleInputId, className: 'pf-input', value: editor.title, disabled: !!busy || !editable, maxLength: 300, onChange: event => editDraftField(draft.draftId, 'title', event.target.value) }),
                  h('div', { className: 'pf-counter' }, `${editor.title.length} / 300`)),
                h('div', { className: 'pf-field', style: { marginTop: 12 } },
                  h('label', { htmlFor: markdownInputId }, 'Markdown 正文'),
                  h('textarea', { id: markdownInputId, className: 'pf-textarea pf-draft-markdown', value: editor.markdown, disabled: !!busy || !editable, maxLength: 100000, onChange: event => editDraftField(draft.draftId, 'markdown', event.target.value) }),
                  h('div', { className: 'pf-counter' }, `${editor.markdown.length} / 100000`)),
                h('div', { className: 'pf-actions' },
                  h(Button, { primary: true, onClick: () => saveDraftRevision(draft), disabled: !!busy || !editable || !dirty || invalid }, '保存新版本'),
                  h(Button, { onClick: () => setDraftEditors(current => ({ ...current, [draft.draftId]: { title: draft.title, markdown: draft.markdown } })), disabled: !!busy || !editable || !dirty }, '放弃修改')),
                h('div', { className: 'pf-field pf-draft-preview-section', style: { marginTop: 12 } },
                  h('div', { className: 'pf-draft-section-head' },
                    h('strong', { id: previewLabelId }, '安全渲染预览（Markdown）'),
                    h('button', { type: 'button', className: 'pf-btn', 'aria-expanded': previewExpanded, 'aria-controls': `pf-draft-preview-${draftIndex}`,
                      onClick: () => setExpandedDrafts(current => ({ ...current, [`preview:${draft.draftId}`]: !previewExpanded })) }, previewExpanded ? '收起预览' : '展开预览')),
                  previewExpanded && hasNewspicPresentation ? h('p', { className: 'pf-muted' }, '当前绑定包含微信图片消息（newspic）：微信接口只接受纯文本，发布时会移除 Markdown 样式和正文图片，但保留段落空行、列表编号、项目符号及行内空格。此处不是微信像素级预览。') : null,
                  previewExpanded ? h('div', { id: `pf-draft-preview-${draftIndex}`, className: 'pf-preview', role: 'region', 'aria-labelledby': previewLabelId }, ...renderMarkdownPreview(editor.markdown, draft.draftId)) : null),
                h('section', { className: 'pf-draft-attempts', 'aria-label': '本地 RSS 生成内容' },
                  h('strong', null, '本地 RSS 生成内容'),
                  draftRssOutputs.length ? draftRssOutputs.map(output => {
                    const detail = rssOutputDetails[output.outputId]
                    return h('article', { className: 'pf-notice', key: output.outputId },
                      h('div', { className: 'pf-row' },
                        h('span', { className: 'pf-code' }, `${output.outputId.slice(0, 12)}… · Draft 修订 ${output.draftVersion}`),
                        h('span', null, displayDraftTime(output.generatedAt)),
                        h(Button, { onClick: () => toggleRssOutput(output.outputId), disabled: !!busy }, detail ? '收起内容' : '查看内容')),
                      h('p', { className: 'pf-code' }, `XML SHA-256 ${output.xmlSha256} · ${output.itemUrl}`),
                      detail ? h('div', null,
                        h('div', { className: 'pf-field' }, h('label', null, 'RSS XML'), h('textarea', { className: 'pf-textarea pf-draft-markdown', value: detail.xml, readOnly: true })),
                        h('div', { className: 'pf-field', style: { marginTop: 12 } }, h('label', null, 'content:encoded HTML'), h('textarea', { className: 'pf-textarea pf-draft-markdown', value: detail.htmlContent, readOnly: true }))) : null)
                  }) : h('p', { className: 'pf-muted' }, '该草稿尚未调用 prismflow_generate_rss_content。')),
                h('div', { className: 'pf-draft-decision' },
                  h('div', { className: 'pf-draft-decision-copy' },
                    h('strong', null, draft.status === 'draft' ? '审核决定' : ['approved', 'published'].includes(draft.status) ? '选择发布渠道' : '草稿管理'),
                    h('span', null, draft.status === 'draft' ? '审批会精确绑定当前显示的版本与 SHA-256。' : ['approved', 'published'].includes(draft.status) ? '每张渠道卡片对应一个固定发布目标；发布器只读取已批准且持久化的 Artifact。' : '被拒绝的草稿可继续修改，或从列表中永久移除。')),
                  deletable ? h('div', { className: 'pf-actions' },
                    draft.status === 'draft' ? h(Button, { primary: true, onClick: () => reviewDraft(draft, 'approve'), disabled: !!busy || dirty }, '批准显示的版本与哈希') : null,
                    draft.status === 'draft' ? h(Button, { danger: true, onClick: () => reviewDraft(draft, 'reject'), disabled: !!busy || dirty }, '拒绝显示的版本与哈希') : null,
                    h(Button, { danger: true, onClick: () => deleteDraft(draft), disabled: !!busy || dirty }, '删除草稿')) : null,
                  ['approved', 'published'].includes(draft.status) ? h('section', { className: 'pf-publish-section', 'aria-label': '可用发布渠道' },
                    h('div', { className: 'pf-publish-section-head' }, h('strong', null, '可用发布目标'), h('span', null, '首次发布与显式重复发布会分别创建独立尝试及回执')),
                    publicationFeedback?.draftId === draft.draftId ? h('div', { className: `pf-notice${publicationFeedback.type === 'error' ? ' pf-notice-error' : ''} pf-publication-feedback`, role: 'status', 'aria-live': 'polite' }, publicationFeedback.text) : null,
                    draft.publishedPublisherIds?.length ? h('div', { className: 'pf-published-list', 'aria-label': '已发布渠道' },
                      h('span', { className: 'pf-published-label' }, '已发布到'),
                      ...draft.publishedPublisherIds.map(publisherId => {
                        const item = publisherPresentation(publishersById.get(publisherId) ?? publisherId)
                        return h('span', { className: 'pf-badge pf-published-chip', key: publisherId }, `${item.channel} · ${item.name}`)
                      })) : null,
                    publishers.length ? h('div', { className: 'pf-publish-grid' }, ...publishers.map(publisher => {
                      const item = publisherPresentation(publisher)
                      const used = draft.publishedPublisherIds?.includes(publisher.id)
                      const readiness = publisherReadiness(draft, publisher)
                      const active = publishingTargetId === publisher.id
                      const blocked = !readiness.ready
                      return h('article', { className: `pf-publish-target${used ? ' pf-publish-target-used' : ''}${blocked ? ' pf-publish-target-blocked' : ''}`, key: publisher.id },
                        h('div', { className: 'pf-publish-target-head' },
                          h('span', { className: 'pf-badge pf-publish-channel' }, item.channel),
                          h('span', { className: `pf-badge${used ? ' pf-published-chip' : ''}${blocked ? ' pf-draft-dirty' : ''}` }, blocked ? '暂不可发布' : used ? '已发布' : '未发布')),
                        h('strong', { className: 'pf-publish-target-name' }, item.name),
                        h('span', { className: 'pf-publish-target-meta' }, item.articleType ? `文章类型：${item.articleType}` : `目标：${item.id}`),
                        blocked ? h('p', { className: 'pf-publish-warning' }, readiness.reason) : null,
                        h(Button, { primary: !used && !blocked, onClick: () => publishDraft(draft, publisher),
                          disabled: !!busy || blocked || draft.reconciliationRequired || (used && draft.status !== 'published'), title: blocked ? readiness.reason : undefined,
                          'aria-label': `${used ? '再次' : '首次'}发布到${item.channel}目标：${item.name}` }, active ? `正在发布到${item.channel}…` : blocked ? '缺少发布条件' : `${used ? '再次' : '首次'}发布到${item.channel}`))
                    })) : h('p', { className: 'pf-muted' }, '当前没有已启用的发布目标。请先前往“发布与存储”完成配置。')) : null),
                h('div', { className: 'pf-draft-attempts' },
                  h('strong', null, '发布尝试历史'),
                  draft.publicationAttempts?.length ? h('div', { className: 'pf-table-wrap' }, h('table', { className: 'pf-table' },
                    h('thead', null, h('tr', null, ['尝试', '意图', '意图令牌', '发布器', '状态', '回执', '目标', '开始', '完成'].map(label => h('th', { key: label }, label)))),
                    h('tbody', null, draft.publicationAttempts.map(attempt => h('tr', { key: attempt.attemptId },
                      h('td', { className: 'pf-code' }, attempt.legacy ? '历史回执（无尝试编号）' : `#${attempt.attemptNumber} ${attempt.attemptId}`), h('td', null, attempt.intent),
                      h('td', { className: 'pf-code' }, attempt.intentId || '-'), h('td', { className: 'pf-code' }, attempt.publisherId), h('td', null, attemptStateLabel(attempt)),
                      h('td', { className: 'pf-code' }, `${attempt.receiptId}${attempt.receiptStatus ? ` (${attempt.receiptStatus})` : ''}`),
                      h('td', { className: 'pf-code' }, attempt.targetIdentifier || '-'), h('td', null, attempt.createdAt), h('td', null, attempt.completedAt || '-'))))))
                    : h('p', { className: 'pf-muted' }, '暂无尝试记录；升级前回执显示为“历史回执（无尝试编号）”。'))
              ) : null)
          })) : h(Empty, null, draftQuery.status || draftQuery.query ? '当前筛选条件下没有草稿。' : '尚无草稿。请先在 DSH Chat 中完成数据处理与 AI 生成。'),
          draftPage.total > 0 ? h('nav', { className: 'pf-review-pagination', 'aria-label': '草稿分页' },
            h('span', { className: 'pf-muted' }, `第 ${draftQuery.page} / ${totalPages} 页，共 ${draftPage.total} 条`),
            h('div', { className: 'pf-actions' },
              h(Button, { onClick: () => queryDraftPage({ ...draftQuery, page: 1 }), disabled: !!busy || draftQuery.page <= 1 }, '首页'),
              h(Button, { onClick: () => queryDraftPage({ ...draftQuery, page: draftQuery.page - 1 }), disabled: !!busy || draftQuery.page <= 1 }, '上一页'),
              h(Button, { onClick: () => queryDraftPage({ ...draftQuery, page: draftQuery.page + 1 }), disabled: !!busy || draftQuery.page >= totalPages }, '下一页'),
              h(Button, { onClick: () => queryDraftPage({ ...draftQuery, page: totalPages }), disabled: !!busy || draftQuery.page >= totalPages }, '末页')))
            : null,
          presentationMediaPreviewView())
      }

      function updatePublisherRow(rowId, operation) {
        setPublisherProfileRows(rows => rows.map(row => row.rowId === rowId ? operation(JSON.parse(JSON.stringify(row))) : row))
      }
      function updatePublisherDestination(rowId, destinationId, path, value, numeric) {
        updatePublisherRow(rowId, row => {
          row.config.destinations = row.config.destinations.map(destination => destination.id === destinationId
            ? withNestedValue(destination, path, numeric ? Number(value) : ['needOpenComment', 'onlyFansCanComment'].includes(path) ? Number(value) : value) : destination)
          return row
        })
      }
      function addPublisherDestination(row) {
        if (row.config.destinations.length > 0) {
          setNotice({ type: 'error', text: '该渠道已经存在目标。为避免重复目标，只能编辑、复制替换或退役现有目标。' })
          return
        }
        const id = `new-${window.crypto.randomUUID().slice(0, 8)}`
        updatePublisherRow(row.rowId, next => { next.config.destinations.push(defaultPublisherDestination(row.channelKind, id)); return next })
        setSelectedPublisherRowId(row.rowId)
        setSelectedPublisherDestinationId(id)
      }
      function clearCompletedPublisherMigration(next) {
        if (next.migrationRequired !== true) return
        const legacy = publisherProfileBaseline.find(item => item.rowId === next.rowId)
        const legacyIds = new Set(legacy?.config.destinations.map(destination => destination.id) ?? [])
        if (next.config.destinations.every(destination => !legacyIds.has(destination.id))) delete next.migrationRequired
      }
      function retirePublisherDestination(row, destination) {
        if (!window.confirm(`确认退役 ${destination.id}？历史审批、Artifact、Attempt 与 Receipt 保持不变；旧草稿可能无法再发布到此 ID。`)) return
        updatePublisherRow(row.rowId, next => { next.config.destinations = next.config.destinations.filter(item => item.id !== destination.id); clearCompletedPublisherMigration(next); return next })
      }
      function replacePublisherDestination(row, destination) {
        const id = `${destination.id}-replacement-${window.crypto.randomUUID().slice(0, 8)}`.slice(0, 128)
        updatePublisherRow(row.rowId, next => {
          next.config.destinations = next.config.destinations.filter(item => item.id !== destination.id)
          next.config.destinations.push({ ...JSON.parse(JSON.stringify(destination)), id, name: `${destination.name}（替换）`, ...newPublisherCredentialRefs(row.channelKind) })
          clearCompletedPublisherMigration(next)
          return next
        })
        setNotice({ type: 'ok', text: `已克隆为新不可变 ID ${id} 并在方案中退役旧 ID；请编辑新目标的运行字段。` })
      }
      async function importPublisherProfileFile(event) {
        const file = event.target.files?.[0]
        if (!file) return
        try {
          if (file.size > 2 * 1024 * 1024) throw new Error('配置文件超过 2 MiB')
          const text = await file.text()
          if (!/^\s*\{/u.test(text)) throw new Error('只接受原生 CLI 导出的 typed JSON，不接受 YAML')
          const documentValue = browserExact(JSON.parse(text), ['kind', 'profile', 'profileHash', 'documentRevision', 'exportedAt', 'rows', 'fingerprint'], 'Profile 文档')
          const canonicalIso = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u
          if (documentValue.kind !== 'PrismFlowPublisherProfileDocument/v2' || !/^[A-Za-z0-9_-]{1,64}$/u.test(documentValue.profile ?? '')
            || !/^[a-f0-9]{64}$/u.test(documentValue.profileHash ?? '') || !/^[a-f0-9]{64}$/u.test(documentValue.documentRevision ?? '') || !/^[a-f0-9]{64}$/u.test(documentValue.fingerprint ?? '')
            || typeof documentValue.exportedAt !== 'string' || documentValue.exportedAt.length !== 24 || !canonicalIso.test(documentValue.exportedAt)
            || new Date(documentValue.exportedAt).toISOString() !== documentValue.exportedAt
            || !Array.isArray(documentValue.rows) || documentValue.rows.length !== 4) throw new Error('Profile 文档边界无效')
          if (await browserSha256(withoutFingerprint(documentValue)) !== documentValue.fingerprint) throw new Error('Profile 文档指纹无效')
          const rowIds = new Set(), rows = []
          for (const rawRow of documentValue.rows) {
            const row = browserExact(rawRow, ['rowId', 'channelKind', 'disabled', 'config', 'configRevision', 'rowRevision', 'migrationRequired'], 'Profile 发布行')
            const definition = publisherChannelDefinitions.find(item => item.rowId === row.rowId)
            if (!definition || row.channelKind !== definition.kind || rowIds.has(row.rowId) || typeof row.disabled !== 'boolean'
              || (row.migrationRequired !== undefined && row.migrationRequired !== true)) throw new Error('Profile 发布行无效')
            rowIds.add(row.rowId)
            const config = normalizePublisherConfigBrowser(row.channelKind, row.config)
            if (await browserSha256({ kind: row.channelKind, config }) !== row.configRevision) throw new Error(`${definition.label} 配置修订无效`)
            const rowBody = { rowId: row.rowId, channelKind: row.channelKind, disabled: row.disabled, configRevision: row.configRevision,
              migrationRequired: row.migrationRequired === true }
            if (await browserSha256(rowBody) !== row.rowRevision) throw new Error(`${definition.label} 行修订无效`)
            rows.push({ rowId: row.rowId, channelKind: row.channelKind, disabled: row.disabled, config, configRevision: row.configRevision,
              rowRevision: row.rowRevision, ...(row.migrationRequired ? { migrationRequired: true } : {}) })
          }
          if (await browserSha256({ profile: documentValue.profile, rows: rows.map(row => ({ rowId: row.rowId, rowRevision: row.rowRevision })) }) !== documentValue.documentRevision) {
            throw new Error('Profile 文档修订无效')
          }
          setPublisherProfileDocument(documentValue); setPublisherProfileRows(rows); setPublisherProfileBaseline(JSON.parse(JSON.stringify(rows)))
          setPublisherMaintenance({ entered: false, drained: false, timedOut: false, activeAttempts: 0 })
          setNotice({ type: 'ok', text: rows.some(row => row.migrationRequired) ? '配置文件已载入；旧版微信凭证引用已隐藏，必须替换目标后才能导出。' : '配置文件已在浏览器本地载入；原文件内容未上传。' })
        } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) }) }
        finally { event.target.value = '' }
      }
      async function savePublisherProfile() {
        const errors = visualPublisherErrors(publisherProfileRows)
        if (errors.length || !publisherProfileDocument) { setNotice({ type: 'error', text: errors[0] ?? '发布配置当前不可用' }); return }
        const changed = publisherProfileRows.filter(row => JSON.stringify(row) !== JSON.stringify(publisherProfileBaseline.find(item => item.rowId === row.rowId)))
        if (!changed.length) { setNotice({ type: 'error', text: '当前没有需要保存的更改' }); return }
        const changes = []
        for (const row of changed) {
          const baseline = publisherProfileBaseline.find(item => item.rowId === row.rowId)
          if (!baseline?.rowRevision) { setNotice({ type: 'error', text: `${row.rowId} 缺少保存所需的基线信息；请重新加载配置` }); return }
          const config = normalizePublisherConfigBrowser(row.channelKind, row.config)
          const configRevision = await browserSha256({ kind: row.channelKind, config })
          changes.push({ rowId: row.rowId, expectedRowRevision: baseline.rowRevision, disabled: row.disabled, config, configRevision })
        }
        const signature = await browserSha256({ profileHash: publisherProfileDocument.profileHash,
          documentRevision: publisherProfileDocument.documentRevision, changes })
        if (publisherPendingOperation) {
          setNotice({ type: 'error', text: '服务器已有尚未完成的配置保存。请先选择“继续保存配置”，或仅在任务尚未暂停时取消。' })
          return
        }
        if (publisherApplyRequest.current && publisherApplyRequest.current.signature !== signature) {
          setNotice({ type: 'error', text: '上次请求结果未知，必须保留完全相同的变更以重试；也可重新加载以从服务器账本核对。' })
          return
        }
        let request = publisherApplyRequest.current?.request
        if (!request) {
          const body = { kind: 'PrismFlowPublisherChangePlan/v2', profile: publisherProfileDocument.profile,
            expectedProfileHash: publisherProfileDocument.profileHash, expectedDocumentRevision: publisherProfileDocument.documentRevision,
            createdAt: new Date().toISOString(), changes }
          const plan = { ...body, fingerprint: await browserSha256(body) }
          request = { operationId: '00000000-0000-4000-8000-000000000000', confirmPauseUntilRestart: true, plan }
        }
        const requestBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength
        if (requestBytes > 32 * 1024) {
          setNotice({ type: 'error', text: `保存请求为 ${requestBytes} 字节，超过页面的 32 KiB 限制；请使用命令行工具提供的 2 MiB 批量配置方案。` })
          return
        }
        const diff = changes.map(change => {
          const definition = publisherChannelDefinitions.find(item => item.rowId === change.rowId)
          const before = publisherProfileBaseline.find(item => item.rowId === change.rowId)
          return `${definition?.label ?? change.rowId}: ${before?.disabled ? '停用' : '启用'} → ${change.disabled ? '停用' : '启用'}；目标 ${before?.config.destinations.length ?? 0} → ${change.config.destinations.length}`
        }).join('\n')
        if (!window.confirm(`保存发布配置\n\n${diff}\n\n系统会先校验配置，然后不可逆地暂停新的生成和发布任务，并等待正在执行的任务结束。配置写入后必须重启 DSH 才会恢复正常运行并生效。确认继续？`)) return
        if (!publisherApplyRequest.current) request = { ...request, operationId: window.crypto.randomUUID().toLowerCase() }
        const value = await run('publisher-profile-apply', async signal => {
          try {
            const applied = await api('/publisher-profile/apply', { body: request, signal })
            setPublisherMaintenance({ entered: applied.maintenance === true || applied.operation?.restartRequired === true,
              drained: applied.drained === true, timedOut: applied.timedOut === true,
              activeAttempts: Number.isInteger(applied.activeAttempts) ? applied.activeAttempts : 0,
              restartRequired: applied.operation?.restartRequired === true })
            setPublisherPendingOperation(applied.operation?.status === 'pending' ? applied.operation : null)
            publisherApplyRequest.current = { signature, request }
            if (applied.operation?.status !== 'completed') return { applied }
            try {
              const refreshed = await readPublisherProfileState(signal)
              return { applied, refreshed }
            } catch (refreshError) {
              return { applied, refreshError }
            }
          } catch (error) {
            const baselineChanged = error instanceof ApiError && error.status === 409
              && /Publisher Profile baseline changed/u.test(error.message)
            if (baselineChanged) {
              publisherApplyRequest.current = null
              const latest = await readPublisherProfileState(signal)
              const latestRows = JSON.parse(JSON.stringify(latest.document.rows))
              const localById = new Map(changed.map(row => [row.rowId, row]))
              const baselineById = new Map(publisherProfileBaseline.map(row => [row.rowId, row]))
              const publisherConflicts = changed.filter(row => {
                const latestRow = latestRows.find(item => item.rowId === row.rowId)
                return !latestRow || latestRow.rowRevision !== baselineById.get(row.rowId)?.rowRevision
              })
              if (publisherConflicts.length) {
                return { rebaseConflict: true, conflictRows: publisherConflicts.map(row => row.rowId) }
              }
              const rebasedRows = latestRows.map(latestRow => {
                const local = localById.get(latestRow.rowId)
                return local ? { ...latestRow, disabled: local.disabled, config: JSON.parse(JSON.stringify(local.config)) } : latestRow
              })
              setPublisherChannels(latest.channels); setPublisherCredentialSlots(latest.credentialSlots)
              setPublisherProfileDocument(latest.document); setPublisherProfileBaseline(latestRows); setPublisherProfileRows(rebasedRows)
              setPublisherPendingOperation(latest.operation?.status === 'pending' ? latest.operation : null)
              return { rebased: true }
            }
            const recoverable = !(error instanceof ApiError) || error.status >= 500
              || error.value?.maintenance === true || error.value?.restartRequired === true
            publisherApplyRequest.current = recoverable ? { signature, request } : null
            throw error
          }
        })
        if (!value) return
        if (value.rebaseConflict) {
          setNotice({ type: 'error', text: `服务器上的发布渠道同时发生了变化（${value.conflictRows.join('、')}）。页面仍保留当前输入；请先使用“查看变更”记录内容，再重新加载并重新应用。` })
          return
        }
        if (value.rebased) {
          setNotice({ type: 'ok', text: '检测到 Profile 基线发生了无关变化；R2 等当前未保存输入已经保留并重新绑定到最新基线。请再次点击“验证并应用配置”。' })
          return
        }
        const applied = value.applied
        setPublisherMaintenance({ entered: applied.maintenance === true || applied.operation?.restartRequired === true,
          drained: applied.drained === true, timedOut: applied.timedOut === true,
          activeAttempts: Number.isInteger(applied.activeAttempts) ? applied.activeAttempts : 0, restartRequired: true })
        if (applied.operation?.status !== 'completed') {
          setPublisherPendingOperation(applied.operation)
          setNotice({ type: 'error', text: `系统已暂停新的生成和发布任务，但仍有 ${applied.activeAttempts ?? 0} 个任务正在执行，或等待已经超时。配置尚未写入；服务器已保留本次请求，页面关闭或重新加载后仍可继续。完成后必须在终端重启 DSH。` })
          return
        }
        setPublisherPendingOperation(null)
        if (value.refreshError) {
          setNotice({ type: 'ok', text: '配置已写入，新的生成和发布任务会继续暂停；必须重启 DSH。写入后重新加载配置失败；成功结果与操作标识已保留，请使用完全相同的更改重试核对，勿创建新的保存请求。' })
          return
        }
        publisherApplyRequest.current = null
        const rows = JSON.parse(JSON.stringify(value.refreshed.document.rows))
        setPublisherChannels(value.refreshed.channels); setPublisherCredentialSlots(value.refreshed.credentialSlots); setPublisherProfileDocument(value.refreshed.document)
        setPublisherProfileRows(rows); setPublisherProfileBaseline(JSON.parse(JSON.stringify(rows)))
        setNotice({ type: 'ok', text: applied.operation.replayed ? '已核对同一次保存的写入结果；配置已保存，必须重启 DSH。' : '配置已保存，新的生成和发布任务已暂停；必须在终端重启 DSH。重启后请重新加载配置并确认运行状态。' })
      }
      async function reconcilePendingPublisherOperation(action) {
        const displayedOperationId = publisherPendingOperation?.operationId
        if (!displayedOperationId) { setNotice({ type: 'error', text: '待恢复操作已变化；请刷新后重试。' }); return }
        if (action === 'resume' && !window.confirm('继续保存会暂停新的生成和发布任务，并等待正在执行的任务结束。暂停一旦开始便不可撤销，配置写入后必须重启 DSH 才会恢复正常运行并生效。确认继续？')) return
        if (action === 'cancel' && !window.confirm('只有服务器确认尚未暂停新任务时，才能取消这次保存。确认请求取消？')) return
        const result = await run(`publisher-profile-${action}`, async signal => {
          const value = await api('/publisher-profile/pending-operation', { body: { action, operationId: displayedOperationId }, signal })
          const operation = value.operation
          setPublisherPendingOperation(operation?.status === 'pending' ? operation : null)
          setPublisherMaintenance(current => ({ ...current,
            entered: value.maintenance === true || operation?.phase === 'draining' || operation?.restartRequired === true || current.entered,
            drained: value.drained === true, timedOut: value.timedOut === true,
            activeAttempts: Number.isInteger(value.activeAttempts) ? value.activeAttempts : 0,
            restartRequired: operation?.restartRequired === true || current.restartRequired }))
          if (action !== 'resume' || operation?.status !== 'completed') return { value }
          publisherCompletedOperation.current = operation
          try { return { value, refreshed: await readPublisherProfileState(signal) } }
          catch (refreshError) { return { value, refreshError } }
        })
        if (!result) return
        const { value } = result
        const operation = value.operation
        if (operation?.status === 'pending') {
          setNotice({ type: 'error', text: '系统仍在等待正在执行的任务结束；服务器已保留本次保存请求，重新加载页面后仍可继续。' })
        } else if (operation?.status === 'cancelled') {
          publisherApplyRequest.current = null
          publisherCompletedOperation.current = null
          setNotice({ type: 'ok', text: '服务器确认任务尚未暂停，本次保存已安全取消。' })
        } else if (result.refreshError) {
          setPublisherChannels([]); setPublisherCredentialSlots([]); setPublisherProfileDocument(null); setPublisherProfileRows([]); setPublisherProfileBaseline([])
          setNotice({ type: 'ok', text: `上一次保存 ${operation.operationId} 已完成并要求重启，但写入后重新加载配置失败。操作标识已保留；编辑器已清空以避免继续编辑过期配置。` })
        } else {
          publisherApplyRequest.current = null
          publisherCompletedOperation.current = null
          const rows = JSON.parse(JSON.stringify(result.refreshed.document.rows))
          setPublisherChannels(result.refreshed.channels); setPublisherCredentialSlots(result.refreshed.credentialSlots); setPublisherProfileDocument(result.refreshed.document)
          setPublisherProfileRows(rows); setPublisherProfileBaseline(JSON.parse(JSON.stringify(rows)))
          setPublisherPendingOperation(result.refreshed.operation?.status === 'pending' ? result.refreshed.operation : null)
          setNotice({ type: 'ok', text: '上一次保存已核对或完成；发布配置和运行状态已刷新，必须按面板提示重启 DSH。' })
        }
      }
      function publisherCredentialKey(rowId, destinationId, field) { return `${rowId}:${destinationId}:${field}` }
      async function refreshPublisherCredentials() {
        const value = await run('publisher-credentials:refresh', signal => api('/publisher-profile/credentials', { signal }), '凭证状态已刷新')
        if (value) setPublisherCredentialSlots(value.slots)
      }
      async function savePublisherCredential(slot) {
        const key = publisherCredentialKey(slot.rowId, slot.destinationId, slot.field)
        const secret = publisherCredentialValues[key] || ''
        if (!secret) { setNotice({ type: 'error', text: '请输入真实凭证后再保存。' }); return }
        const value = await run(`publisher-credential:set:${key}`, async signal => {
          await api('/publisher-profile/credential/set', { body: { rowId: slot.rowId, destinationId: slot.destinationId,
            field: slot.field, expectedConfigRevision: slot.configRevision, value: secret }, signal })
          return api('/publisher-profile/credentials', { signal })
        }, slot.configured ? '发布凭证已安全轮换并立即生效' : '发布凭证已安全保存并立即生效')
        if (value) {
          setPublisherCredentialValues(current => ({ ...current, [key]: '' }))
          setPublisherCredentialSlots(value.slots)
        }
      }
      async function removePublisherCredential(slot) {
        if (!window.confirm(`移除 ${slot.label}？保存的真实凭证将被删除，对应发布目标会在重新配置前无法发布。`)) return
        const key = publisherCredentialKey(slot.rowId, slot.destinationId, slot.field)
        const value = await run(`publisher-credential:unset:${key}`, async signal => {
          await api('/publisher-profile/credential/unset', { body: { rowId: slot.rowId, destinationId: slot.destinationId,
            field: slot.field, expectedConfigRevision: slot.configRevision }, signal })
          return api('/publisher-profile/credentials', { signal })
        }, '发布凭证已移除')
        if (value) {
          setPublisherCredentialValues(current => ({ ...current, [key]: '' }))
          setPublisherCredentialSlots(value.slots)
        }
      }
      function publisherProfileView() {
        const errors = visualPublisherErrors(publisherProfileRows)
        const hasUnappliedChanges = !!publisherProfileDocument && publisherProfileRows.some(row => JSON.stringify(row) !== JSON.stringify(publisherProfileBaseline.find(item => item.rowId === row.rowId)))
        const baselineIds = new Set(publisherProfileBaseline.flatMap(row => row.config.destinations.map(destination => `${row.rowId}:${destination.id}`)))
        function renderDestinationField(row, destination, immutable, field) {
          const [path, label, mode, metadata = {}] = field
          const mutableExistingField = path === 'name' || (row.channelKind === 'wechat-draft' && ['apiOrigin', 'allowInsecureHttp', 'ffmpegPath'].includes(path))
          const disabled = metadata.locked === true || (immutable && !mutableExistingField)
          if (mode === 'switch') return h(Switch, { key: path, label, checked: nestedValue(destination, path) === 1, disabled,
            onChange: checked => updatePublisherDestination(row.rowId, destination.id, path, checked ? '1' : '0', true) })
          const numericHelp = mode === 'number' && metadata.min !== undefined && metadata.max !== undefined
            ? `范围：${metadata.min.toLocaleString('en-US')}–${metadata.max.toLocaleString('en-US')}` : undefined
          return h(Field, { key: path, label, value: String(nestedValue(destination, path) ?? ''),
            type: mode === 'number' ? 'number' : 'text', options: Array.isArray(mode) ? mode : undefined,
            min: metadata.min, max: metadata.max, maxLength: metadata.maxLength, help: metadata.help ?? numericHelp,
            disabled, onChange: value => updatePublisherDestination(row.rowId, destination.id, path, value, mode === 'number') })
        }
        function renderPublisherCredentials(row, destination, immutable, definition) {
          const credentialFields = definition.fields.filter(([path]) => /Credential$/u.test(path))
          if (!credentialFields.length) return null
          return h('section', { className: 'pf-publisher-credentials', 'aria-label': `${destination.name} 安全凭证` },
            h('div', { className: 'pf-publisher-credentials-head' },
              h('strong', null, '安全凭证'), h('span', null, '引用由系统管理；真实值只写入 DSH Credential Store，页面永不读取或回显。')),
            ...credentialFields.map(([field, label]) => {
              const slot = publisherCredentialSlots.find(item => item.rowId === row.rowId && item.destinationId === destination.id && item.field === field)
              const key = publisherCredentialKey(row.rowId, destination.id, field)
              const secret = publisherCredentialValues[key] || ''
              const inputId = `pf-publisher-secret-${row.rowId}-${destination.id}-${field}`
              const enabled = immutable && slot && !slot.invalidRef && slot.writable
              const stateLabel = !immutable ? '先保存发布配置' : slot?.invalidRef ? '凭证引用无效' : slot?.configured ? '已安全存储' : slot?.writable ? '尚未填写' : '只读或不可用'
              return h('div', { className: 'pf-publisher-credential-row', key: field },
                h('div', { className: 'pf-row pf-space' }, h('strong', null, label), h(Badge, { enabled: slot?.configured === true }, stateLabel)),
                slot?.invalidRef ? h('p', { className: 'pf-field-error', role: 'alert' }, '检测到旧配置曾把真实凭证写入引用字段。请立即撤销旧凭证并点击“替换目标”；系统会为新目标自动生成安全引用。') : null,
                !immutable ? h('p', { className: 'pf-field-help' }, '先保存包含此目标的发布配置；保存完成后无需离开本页即可填写真实凭证。') : null,
                h('div', { className: 'pf-form' },
                  h('div', { className: 'pf-field pf-publisher-secret-field' },
                    h('label', { htmlFor: inputId }, slot?.configured ? '输入新值以轮换' : '真实凭证'),
                    h('input', { id: inputId, className: 'pf-input', type: 'password', value: secret, disabled: !!busy || !enabled,
                      autoComplete: 'new-password', spellCheck: false, placeholder: slot?.configured ? '输入新值以轮换（不会显示旧值）' : '在此粘贴真实凭证',
                      onChange: event => setPublisherCredentialValues(current => ({ ...current, [key]: event.target.value })) })),
                  h(Button, { primary: true, onClick: () => savePublisherCredential(slot), disabled: !!busy || !enabled || !secret }, slot?.configured ? '轮换凭证' : '保存凭证'),
                  h(Button, { danger: true, onClick: () => removePublisherCredential(slot), disabled: !!busy || !enabled || !slot?.configured }, '移除凭证')))
            }))
        }
        function renderPublisherEditor(definition) {
          const row = publisherProfileRows.find(item => item.rowId === definition.rowId)
          if (!row) return h('section', { className: 'pf-card', key: definition.rowId }, h('h3', null, definition.label), h('p', null, '发布配置当前不可用。'))
          const visibleFields = definition.fields.filter(([path]) => !/Credential$/u.test(path))
          const basicFields = visibleFields.filter(([, , , metadata]) => metadata?.advanced !== true)
          const advancedFields = visibleFields.filter(([, , , metadata]) => metadata?.advanced === true)
          return h('section', { className: 'pf-card', key: row.rowId, 'data-publisher-group': definition.group },
            h('div', { className: 'pf-row pf-space' }, h('h3', null, definition.label),
              h('label', { className: 'pf-check' }, h('input', { type: 'checkbox', checked: !row.disabled, onChange: event => updatePublisherRow(row.rowId, next => { next.disabled = !event.target.checked; return next }) }), '在下次重启后启用')),
            definition.nativeAddition ? h('p', { className: 'pf-native-note' }, 'DSH 原生新增能力；不是原 PrismFlow 媒体存储或图床的等价替代。') : null,
            h('p', { className: 'pf-muted' }, definition.kind === 'wechat-draft'
              ? '显示名称、API Base URL 和 HTTP 风险开关可沿用 ID 直接更新；App ID、文章类型及其他目标身份变更必须“替换目标”。密钥引用由系统管理且不显示。'
              : '仅显示名称可沿用 ID；任何运行字段变更必须“替换目标”生成新 ID 后退役旧 ID。密钥引用由系统管理且不显示。'),
            row.config.destinations.map(destination => {
              const immutable = baselineIds.has(`${row.rowId}:${destination.id}`)
              return h('div', { className: 'pf-card', style: { marginTop: 12 }, key: destination.id },
                h('div', { className: 'pf-form' }, basicFields.map(field => renderDestinationField(row, destination, immutable, field))),
                renderPublisherCredentials(row, destination, immutable, definition),
                advancedFields.length ? h('details', { className: 'pf-deployment-details' },
                  h('summary', null, '高级部署策略'),
                  h('p', { className: 'pf-muted' }, '部署限制、容量、超时、并发、API 地址与提交模板。默认折叠，修改后仍使用与页面保存相同的安全校验和写入流程。'),
                  h('div', { className: 'pf-form' }, advancedFields.map(field => renderDestinationField(row, destination, immutable, field)))) : null,
                h('div', { className: 'pf-actions' }, immutable ? h(Button, { onClick: () => replacePublisherDestination(row, destination) }, '替换目标（新 ID）') : null,
                  h(Button, { danger: true, onClick: () => retirePublisherDestination(row, destination) }, '移除 / 退役目标')))
            }),
            h('div', { className: 'pf-actions' }, h(Button, { onClick: () => addPublisherDestination(row) }, '新增目标')))
        }
        function renderPublisherGroup(title, group, help) {
          return h('section', { className: 'pf-publisher-group', 'data-publisher-group': group },
            h('h3', { className: 'pf-publisher-group-title' }, title), help ? h('p', { className: 'pf-section-help' }, help) : null,
            h('div', { className: 'pf-publisher-group-grid' }, publisherChannelDefinitions.filter(definition => definition.group === group).map(renderPublisherEditor)))
        }
        const publisherStateLabel = publisherMaintenance.restartRequired
          ? '保存后需要重启' : hasUnappliedChanges ? '有未保存更改' : '配置无更改'
        const publisherStateClass = publisherMaintenance.restartRequired
          ? 'pf-publisher-state-restart' : hasUnappliedChanges ? 'pf-publisher-state-dirty' : 'pf-ok'
        function reloadPublisherProfile() {
          if (hasUnappliedChanges && !window.confirm('放弃未保存的发布配置修改并重新加载服务器配置？')) return
          void loadPublisherChannels()
        }
        return h(React.Fragment, null,
          h('h2', { className: 'pf-section-title' }, '发布与存储管理'),
          h('p', { className: 'pf-section-help' }, '按发布渠道和输出存储配置目标。Credential Ref 由系统生成并隐藏，不可编辑；真实 Token、Secret 和 Access Key 在目标卡片的“安全凭证”区域直接填写，只写入 DSH Credential Store，页面永不读取或回显。'),
          h('div', { className: 'pf-actions', style: { marginBottom: 14 } }, h(Button, { onClick: refreshPublisherCredentials, disabled: !!busy }, '刷新凭证状态')),
          renderPublisherGroup('发布渠道', 'publish'),
          renderPublisherGroup('内容与媒体存储', 'artifact', '本地目录用于 Markdown Artifact 归档；Cloudflare R2 同时承载批准内容和 Production Media 对象，所有目标参数由 Profile 固定。'),
          h('section', { className: 'pf-publisher-group', 'data-publisher-group': 'unsupported' },
            h('h3', { className: 'pf-publisher-group-title' }, '尚未原生支持'),
            h('div', { className: 'pf-publisher-group-grid' },
              h('article', { className: 'pf-card', 'aria-readonly': true }, h('h3', null, 'RSS Feed'),
                h('p', null, 'DSH 尚未原生实现 RSS 发布运行时；RSS 当前仅可作为数据源，不能作为发布目标。'), h(Badge, { enabled: false }, '只读 · 不可启用')),
              h('article', { className: 'pf-card', 'aria-readonly': true }, h('h3', null, '小红书'),
                h('p', null, 'DSH 尚无原生小红书发布运行时；不提供浏览器自动化、假启用或发布操作。'), h(Badge, { enabled: false }, '只读 · 不可启用')))),
          h('footer', { className: 'pf-publisher-save-footer', 'aria-labelledby': 'pf-publisher-save-title' },
            h('div', { className: 'pf-publisher-state-head' },
              h('h3', { id: 'pf-publisher-save-title' }, '保存发布配置'),
              h('span', { className: `pf-badge pf-publisher-state-badge ${publisherStateClass}`, role: 'status', 'aria-live': 'polite' }, publisherStateLabel)),
            h('p', { className: 'pf-publisher-save-copy' }, '保存前会先校验配置，并等待正在执行的生成和发布任务结束。配置写入后需要重启 DSH 才会生效；草稿、回执和历史记录不会被删除。'),
            !publisherProfileDocument ? h('p', { className: 'pf-field-error', role: 'status' }, '发布配置当前不可用。可以重新加载配置，或在下方高级工具中导入配置文件。')
              : errors.length ? h('p', { className: 'pf-field-error', role: 'alert' }, errors[0]) : null,
            publisherPendingOperation ? h('div', { className: 'pf-compact-callout', role: 'alert' },
              h('strong', null, '检测到尚未完成的配置保存'),
              h('p', null, '上一次保存请求已由服务器保留。继续会等待当前任务结束并完成写入；只有尚未暂停新任务时才能取消。'),
              h('ol', { className: 'pf-compact-steps' },
                h('li', null, '继续：完成上一次保存请求'),
                h('li', null, '取消：仅限暂停新任务之前')),
              h('div', { className: 'pf-actions' },
                h(Button, { primary: true, disabled: !!busy || publisherPendingOperation.canResume === false,
                  onClick: () => reconcilePendingPublisherOperation('resume') }, '继续保存配置'),
                h(Button, { danger: true, disabled: !!busy || publisherPendingOperation.canCancel !== true,
                  onClick: () => reconcilePendingPublisherOperation('cancel') }, '取消（暂停任务前）'))) : null,
            h('div', { className: 'pf-actions' },
              h(Button, { onClick: reloadPublisherProfile, disabled: !!busy }, hasUnappliedChanges ? '放弃修改并重新加载' : '重新加载配置'),
              h(Button, { primary: true, disabled: !!busy || !!publisherPendingOperation || !!errors.length || !hasUnappliedChanges, onClick: savePublisherProfile },
                hasUnappliedChanges ? '保存配置并准备重启' : '没有需要保存的更改'))),
          h('details', { className: 'pf-publisher-tool-details' },
            h('summary', null, '高级：命令行批量配置（备用）'),
            h('p', null, '一般用户无需使用。仅当保存请求超过 32 KiB，或需要通过脚本批量部署时，才导入由命令行工具导出的 JSON 配置文件。'),
            h('input', { className: 'pf-input', type: 'file', accept: 'application/json,.json', onChange: importPublisherProfileFile, 'aria-label': '导入发布配置 JSON 文件' })),
          h('details', { className: 'pf-runtime-details' }, h('summary', null, '运行诊断'),
            h('p', null, '运行状态、配置 revision 与重启要求仅用于诊断，不改变保存语义。'),
            publisherPendingOperation ? h('p', { className: 'pf-code' }, `operation: ${publisherPendingOperation.operationId} · phase: ${publisherPendingOperation.phase || 'legacy'} · recovery: ${publisherPendingOperation.recoveryState || 'unknown'}`) : null,
            h('div', { className: 'pf-grid' }, publisherChannelDefinitions.map(definition => {
              const channel = publisherChannels.find(item => item.kind === definition.kind) ?? { destinations: [], configured: false, active: false, disabled: true, configRevision: '' }
              const imported = publisherProfileRows.find(item => item.rowId === definition.rowId)
              const baseline = publisherProfileBaseline.find(item => item.rowId === definition.rowId)
              const pendingLocalChange = imported && JSON.stringify(imported) !== JSON.stringify(baseline)
              const runtimeApplied = publisherRuntimeApplied(imported, channel)
              const restartRequired = imported && (pendingLocalChange || !runtimeApplied)
              return h('div', { className: 'pf-card', key: definition.kind },
                h('div', { className: 'pf-row pf-space' }, h('h3', null, definition.label), h(Badge, { enabled: channel.active }, channel.active ? '运行中' : '已停用')),
                h('p', { className: 'pf-code' }, `kind: ${definition.kind}`),
                h('p', null, channel.destinations.length ? channel.destinations.map(item => `${item.id} · ${item.name}`).join('；') : '无活动目标'),
                h('p', { className: 'pf-code' }, `runtime revision: ${channel.configRevision || '-'}`),
                restartRequired ? h(Badge, { enabled: false }, '需要重启以应用') : imported ? h(Badge, { enabled: true }, '已应用') : null)
            })),
            publisherMaintenance.timedOut ? h('p', { className: 'pf-field-error', role: 'alert' }, `系统仍处于暂停新任务状态；还有 ${publisherMaintenance.activeAttempts} 个任务正在执行，或等待已经超时。配置尚未写入，请继续同一次保存；最终必须重启 DSH。`) : null,
            publisherMaintenance.restartRequired ? h('div', { className: 'pf-notice' },
              h('strong', null, '需要重启 DSH'),
              h('p', null, '请在启动 DSH 的终端停止当前进程，并使用原部署命令重新启动。重启后点击“重新加载配置”，仅当运行时 revision 匹配时才算应用成功。')) : null))
      }

      function receiptsView() {
        if (!status?.services.receipts) return h(Empty, null, 'Publication Receipt Store 未启用。')
        return h(React.Fragment, null,
          h('div', { className: 'pf-actions', style: { marginBottom: 14 } }, h(Button, { onClick: refreshReceipts, disabled: !!busy }, '刷新审计记录')),
          receipts.length ? h('div', { className: 'pf-table-wrap' }, h('table', { className: 'pf-table' },
            h('thead', null, h('tr', null, ['时间', '发布器', '尝试', '模式', '状态', '条数', '草稿版本', 'Artifact SHA-256', '触发方式', '验证', '目标'].map(x => h('th', { key: x }, x)))),
            h('tbody', null, receipts.map(item => h('tr', { key: item.receiptId },
              h('td', null, item.recordedAt), h('td', { className: 'pf-code' }, item.publisherId),
              h('td', { className: 'pf-code' }, item.publicationAttemptId ? `#${item.publicationAttemptNumber} ${item.publicationAttemptId}` : '历史回执（无尝试编号）'),
              h('td', null, item.articleType || '-'), h('td', null, h(Badge, { enabled: ['created', 'updated'].includes(item.status) }, item.status)), h('td', null, item.itemCount),
              h('td', { className: 'pf-code' }, item.draftId ? `${item.draftId} · 修订 ${item.draftVersion ?? '-'}` : '-'), h('td', { className: 'pf-code' }, item.artifactSha256 || '-'),
              h('td', null, item.trigger), h('td', null, item.verification || '-'),
              h('td', null, safeLinkUrl(item.publicUrl) ? h('a', { className: 'pf-link', href: safeLinkUrl(item.publicUrl), target: '_blank', rel: 'noreferrer' }, '打开') : (item.wechatDraftMediaId || item.repository || item.bucket || item.path || item.fileName || '-'))
            ))))) : h(Empty, null, '没有发布审计记录'))
      }

      function publisherProfileManagerView() {
        const errors = visualPublisherErrors(publisherProfileRows)
        const changedRows = publisherProfileRows.filter(row => JSON.stringify(row) !== JSON.stringify(publisherProfileBaseline.find(item => item.rowId === row.rowId)))
        const hasUnappliedChanges = !!publisherProfileDocument && changedRows.length > 0
        const baselineIds = new Set(publisherProfileBaseline.flatMap(row => row.config.destinations.map(destination => `${row.rowId}:${destination.id}`)))
        const selectedDefinition = publisherChannelDefinitions.find(item => item.rowId === selectedPublisherRowId) ?? publisherChannelDefinitions[0]
        const selectedRow = publisherProfileRows.find(item => item.rowId === selectedDefinition.rowId)
        const selectedDestination = selectedRow?.config.destinations.find(item => item.id === selectedPublisherDestinationId) ?? selectedRow?.config.destinations[0]
        const selectedChannel = publisherChannels.find(item => item.kind === selectedDefinition.kind)
        const runtimeApplied = selectedRow ? publisherRuntimeApplied(selectedRow, selectedChannel) : false
        const selectedState = selectedRow && !selectedRow.disabled && selectedChannel?.active && runtimeApplied ? '运行中'
          : selectedRow && !selectedRow.disabled && !runtimeApplied ? '等待重启' : '已停用'
        function selectPublisherRow(row) {
          setSelectedPublisherRowId(row.rowId)
          setSelectedPublisherDestinationId(row.config.destinations[0]?.id ?? '')
        }
        function renderManagerField(row, destination, immutable, field) {
          const [path, label, mode, metadata = {}] = field
          const mutableExistingField = path === 'name' || (row.channelKind === 'wechat-draft' && ['apiOrigin', 'allowInsecureHttp', 'ffmpegPath'].includes(path))
          const disabled = metadata.locked === true || (immutable && !mutableExistingField)
          if (mode === 'switch') return h(Switch, { key: path, label, checked: nestedValue(destination, path) === 1, disabled,
            onChange: checked => updatePublisherDestination(row.rowId, destination.id, path, checked ? '1' : '0', true) })
          const numericHelp = mode === 'number' && metadata.min !== undefined && metadata.max !== undefined
            ? `范围：${metadata.min.toLocaleString('en-US')}–${metadata.max.toLocaleString('en-US')}` : undefined
          return h(Field, { key: path, label, value: String(nestedValue(destination, path) ?? ''),
            type: mode === 'number' ? 'number' : 'text', options: Array.isArray(mode) ? mode : undefined,
            min: metadata.min, max: metadata.max, maxLength: metadata.maxLength, help: metadata.help ?? numericHelp,
            disabled, onChange: value => updatePublisherDestination(row.rowId, destination.id, path, value, mode === 'number') })
        }
        function renderManagerCredentials(row, destination, immutable, definition) {
          const credentialFields = definition.fields.filter(([path]) => /Credential$/u.test(path))
          if (!credentialFields.length) return h('p', { className: 'pf-muted' }, '此目标不需要外部凭证。')
          return h('div', null, h('p', { className: 'pf-muted' }, '真实凭证仅写入 DSH Credential Store；页面不会读取或回显旧值。'),
            ...credentialFields.map(([field, label]) => {
              const slot = publisherCredentialSlots.find(item => item.rowId === row.rowId && item.destinationId === destination.id && item.field === field)
              const key = publisherCredentialKey(row.rowId, destination.id, field)
              const secret = publisherCredentialValues[key] || ''
              const inputId = `pf-publisher-secret-${row.rowId}-${destination.id}-${field}`
              const enabled = immutable && slot && !slot.invalidRef && slot.writable
              const stateLabel = !immutable ? '先应用目标配置' : slot?.invalidRef ? '凭证引用无效' : slot?.configured ? '已安全存储' : slot?.writable ? '尚未填写' : '只读或不可用'
              return h('section', { className: 'pf-publisher-credentials', key: field },
                h('div', { className: 'pf-publisher-credentials-head' }, h('strong', null, label), h(Badge, { enabled: slot?.configured === true }, stateLabel)),
                slot?.invalidRef ? h('p', { className: 'pf-field-error', role: 'alert' }, '旧配置包含不安全凭证引用。请撤销旧凭证并复制为新目标。') : null,
                h('div', { className: 'pf-form' }, h('div', { className: 'pf-field pf-publisher-secret-field' },
                  h('label', { htmlFor: inputId }, slot?.configured ? '输入新值以轮换' : '真实凭证'),
                  h('input', { id: inputId, className: 'pf-input', type: 'password', value: secret, disabled: !!busy || !enabled,
                    autoComplete: 'new-password', spellCheck: false, placeholder: slot?.configured ? '输入新值以轮换（不会显示旧值）' : '在此粘贴真实凭证',
                    onChange: event => setPublisherCredentialValues(current => ({ ...current, [key]: event.target.value })) })),
                  h(Button, { primary: true, onClick: () => savePublisherCredential(slot), disabled: !!busy || !enabled || !secret }, slot?.configured ? '轮换凭证' : '保存凭证'),
                  h(Button, { danger: true, onClick: () => removePublisherCredential(slot), disabled: !!busy || !enabled || !slot?.configured }, '移除凭证')))
            }))
        }
        function reloadPublisherProfile() {
          if (hasUnappliedChanges && !window.confirm('放弃未保存的发布配置修改并重新加载服务器配置？')) return
          void loadPublisherChannels()
        }
        function showPublisherChanges() {
          const labels = changedRows.map(row => publisherChannelDefinitions.find(item => item.rowId === row.rowId)?.label ?? row.channelKind)
          setNotice({ type: 'success', text: labels.length ? `待应用：${labels.join('、')}` : '当前没有未保存更改' })
        }
        function renderRailGroup(title, group) {
          return h('section', { className: 'pf-publisher-rail-group', key: group },
            h('h3', { className: 'pf-publisher-rail-title' }, title),
            ...publisherChannelDefinitions.filter(item => item.group === group).map(definition => {
              const row = publisherProfileRows.find(item => item.rowId === definition.rowId)
              const channel = publisherChannels.find(item => item.kind === definition.kind)
              const count = row?.config.destinations.length ?? 0
              const pending = row && JSON.stringify(row) !== JSON.stringify(publisherProfileBaseline.find(item => item.rowId === row.rowId))
              return h('button', { type: 'button', key: definition.rowId,
                className: `pf-publisher-rail-item${definition.rowId === selectedDefinition.rowId ? ' pf-publisher-rail-item-on' : ''}`,
                onClick: () => row && selectPublisherRow(row), 'aria-current': definition.rowId === selectedDefinition.rowId ? 'page' : undefined },
                h('span', null, h('span', { className: 'pf-publisher-rail-name' }, definition.label),
                  h('span', { className: 'pf-publisher-rail-meta' }, `${count} 个目标 · ${row?.disabled ? '已停用' : channel?.active ? '运行中' : '待重启'}`)),
                pending ? h('span', { className: 'pf-badge pf-publisher-state-dirty' }, '已修改') : null)
            }))
        }
        const basicFields = selectedDefinition.fields.filter(([path, , , metadata]) => !/Credential$/u.test(path) && metadata?.advanced !== true)
        const advancedFields = selectedDefinition.fields.filter(([path, , , metadata]) => !/Credential$/u.test(path) && metadata?.advanced === true)
        const immutable = selectedRow && selectedDestination ? baselineIds.has(`${selectedRow.rowId}:${selectedDestination.id}`) : false
        return h('div', { className: 'pf-publisher-page' },
          h('header', { className: 'pf-publisher-toolbar' },
            h('div', { className: 'pf-publisher-toolbar-copy' }, h('h2', { className: 'pf-section-title' }, '发布与存储'),
              h('p', { className: 'pf-section-help' }, '选择一个渠道和目标进行编辑。身份字段保持只读；需要改变目标身份时请复制为新目标。')),
            h('div', { className: 'pf-publisher-toolbar-actions' },
              h(Badge, { enabled: !publisherMaintenance.restartRequired }, publisherMaintenance.restartRequired ? '需要重启' : '配置已加载'),
              h(Button, { onClick: refreshPublisherCredentials, disabled: !!busy }, '刷新'),
              h('details', { className: 'pf-publisher-overflow' }, h('summary', { className: 'pf-btn' }, '更多'),
                h('div', { className: 'pf-publisher-overflow-panel' },
                  h('strong', null, '配置工具'), h('p', { className: 'pf-muted' }, '仅在批量部署或诊断时使用。'),
                  h('input', { className: 'pf-input', type: 'file', accept: 'application/json,.json', onChange: importPublisherProfileFile, 'aria-label': '导入发布配置 JSON 文件' }),
                  h('hr', null), h('strong', null, '运行诊断'),
                  ...publisherChannelDefinitions.map(definition => {
                    const channel = publisherChannels.find(item => item.kind === definition.kind)
                    return h('p', { className: 'pf-code', key: definition.kind }, `${definition.label}: ${channel?.active ? '运行中' : '已停用'} · ${channel?.configRevision || '-'}`)
                  }),
                  publisherMaintenance.restartRequired ? h('div', { className: 'pf-notice' }, '配置已写入。请停止并重新启动 DSH，然后刷新本页。') : null)))),
          h('div', { className: 'pf-publisher-layout' },
            h('nav', { className: 'pf-publisher-rail', 'aria-label': '发布与存储目标' },
              renderRailGroup('发布渠道', 'publish'), renderRailGroup('内容与媒体存储', 'artifact')),
            h('main', { className: 'pf-publisher-workspace' }, selectedRow ? h(React.Fragment, null,
              h('header', { className: 'pf-publisher-workspace-head' },
                h('div', null, h('h3', null, selectedDefinition.label), h('p', null, `${selectedRow.config.destinations.length} 个目标 · ${selectedState}`)),
                h('label', { className: 'pf-check' }, h('input', { type: 'checkbox', checked: !selectedRow.disabled,
                  onChange: event => updatePublisherRow(selectedRow.rowId, next => { next.disabled = !event.target.checked; return next }) }), '启用渠道')),
              selectedRow.config.destinations.length ? h(React.Fragment, null,
                h('div', { className: 'pf-publisher-targetbar' },
                  h(Field, { className: 'pf-publisher-target-select', label: '当前目标', value: selectedDestination?.id ?? '',
                    options: selectedRow.config.destinations.map(item => ({ value: item.id, label: item.name })), onChange: setSelectedPublisherDestinationId })),
                selectedDestination ? h('article', { className: 'pf-publisher-editor' },
                  h('header', { className: 'pf-publisher-editor-head' }, h('div', null, h('h4', null, selectedDestination.name),
                    h('p', { className: 'pf-code' }, selectedDestination.id)), h(Badge, { enabled: immutable }, immutable ? '已保存目标' : '新目标')),
                  selectedDefinition.nativeAddition ? h('p', { className: 'pf-native-note' }, selectedDefinition.nativeNote) : null,
                  h('section', { className: 'pf-publisher-section' }, h('h4', { className: 'pf-publisher-section-title' }, '基本信息与发布行为'),
                    h('div', { className: 'pf-publisher-field-grid' }, basicFields.map(field => renderManagerField(selectedRow, selectedDestination, immutable, field)))),
                  advancedFields.length ? h('details', { className: 'pf-publisher-disclosure' }, h('summary', null, '网络与容量限制'),
                    h('div', { className: 'pf-publisher-disclosure-body pf-publisher-field-grid' }, advancedFields.map(field => renderManagerField(selectedRow, selectedDestination, immutable, field)))) : null,
                  h('details', { className: 'pf-publisher-disclosure' }, h('summary', null, '安全凭证'),
                    h('div', { className: 'pf-publisher-disclosure-body' }, renderManagerCredentials(selectedRow, selectedDestination, immutable, selectedDefinition))),
                  h('details', { className: 'pf-publisher-disclosure pf-publisher-danger' }, h('summary', null, '危险操作'),
                    h('div', { className: 'pf-publisher-disclosure-body' },
                      h('p', { className: 'pf-muted' }, '目标身份变更必须复制为新目标；退役不会删除历史回执。'),
                      h('div', { className: 'pf-actions' }, immutable ? h(Button, { onClick: () => replacePublisherDestination(selectedRow, selectedDestination) }, '复制为新目标') : null,
                        h(Button, { danger: true, onClick: () => retirePublisherDestination(selectedRow, selectedDestination) }, '退役目标'))))
                ) : null) : h('section', { className: 'pf-publisher-empty' }, h('h3', null, '此渠道还没有目标'),
                  h('p', null, '创建目标后只编辑当前目标，不会展开其他渠道配置。'), h(Button, { primary: true, onClick: () => addPublisherDestination(selectedRow) }, '创建第一个目标'))
            ) : h(Empty, null, '发布配置当前不可用。'))),
          h('footer', { className: 'pf-publisher-save-footer pf-publisher-changebar', 'aria-label': '发布配置变更' },
            h('div', { className: 'pf-publisher-change-copy' }, h('strong', null, hasUnappliedChanges ? `${changedRows.length} 个渠道有未保存更改` : '没有未保存更改'),
              h('span', null, publisherMaintenance.restartRequired ? '配置已写入，需要重启 DSH。' : '应用前会校验配置并等待活动任务结束。'),
              errors.length ? h('p', { className: 'pf-field-error', role: 'alert' }, `无法保存：${errors[0]}`) : null),
            h('div', { className: 'pf-actions' },
              h(Button, { onClick: showPublisherChanges, disabled: !hasUnappliedChanges }, '查看变更'),
              h(Button, { onClick: reloadPublisherProfile, disabled: !!busy || !hasUnappliedChanges }, '放弃修改'),
              h(Button, { primary: true, disabled: !!busy || !!publisherPendingOperation || !hasUnappliedChanges, onClick: savePublisherProfile }, '验证并应用配置'))),
          publisherPendingOperation ? h('div', { className: 'pf-compact-callout', role: 'alert' }, h('strong', null, '检测到尚未完成的配置保存'),
            h('p', null, '继续会等待当前任务结束并完成同一次写入。'), h('div', { className: 'pf-actions' },
              h(Button, { primary: true, disabled: !!busy || publisherPendingOperation.canResume === false, onClick: () => reconcilePendingPublisherOperation('resume') }, '继续保存配置'),
              h(Button, { danger: true, disabled: !!busy || publisherPendingOperation.canCancel !== true, onClick: () => reconcilePendingPublisherOperation('cancel') }, '取消（暂停任务前）'))) : null)
      }

      const views = { overview: overviewView, 'source-settings': sourceSettingsView, content: contentView, toolsets: toolsetsView, workflows: workflowBuilderView, review: reviewView, 'publisher-profile': publisherProfileManagerView, receipts: receiptsView }
      return h('div', { className: 'pf-shell' },
        h('div', { className: 'pf-shell-top' },
          h('div', { className: 'pf-head' }, h('div', null, h('h1', { className: 'pf-title' }, 'PrismFlow 流光'), h('p', { className: 'pf-sub' }, '受控配置、不可变草稿审核、可信 Artifact 发布与审计'), h('p', { className: 'pf-version' }, `@prismflow/dsh · ${status?.pluginVersion ?? '加载中…'}`)), busy ? h(Badge, { enabled: true }, '处理中…') : h(Badge, { enabled: true }, '就绪')),
          h('div', { className: 'pf-tabs' }, tabs.map(([id, label]) => h('button', { type: 'button', key: id, className: `pf-tab${tab === id ? ' pf-tab-on' : ''}`, onClick: () => switchDashboardTab(id) }, label)))),
        h('div', { className: 'pf-shell-content' },
        notice ? h('div', {
          className: `pf-notice${notice.type === 'error' ? ' pf-notice-error' : ''}`,
          role: notice.type === 'error' ? 'alert' : 'status',
          'aria-live': notice.type === 'error' ? 'assertive' : 'polite',
        }, notice.text) : null,
        publisherPendingOperation && tab !== 'publisher-profile' ? h('div', { className: 'pf-notice pf-notice-error', role: 'alert' },
          h('strong', null, '检测到尚未完成的配置保存'),
          h('p', null, '服务器已保留上一次保存请求；可以安全关闭或重新加载页面。'),
          h('div', { className: 'pf-actions' },
            h(Button, { primary: true, disabled: !!busy || publisherPendingOperation.canResume === false,
              onClick: () => reconcilePendingPublisherOperation('resume') }, '继续保存配置'),
            h(Button, { danger: true, disabled: !!busy || publisherPendingOperation.canCancel !== true,
              onClick: () => reconcilePendingPublisherOperation('cancel') }, '取消（暂停任务前）'))) : null,
        views[tab](),
        ),
      )
    }

    const inject = ['slots']
    function apply(ctx) {
      const controller = createDashboardController()
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'prismflow-prompt-suggestions',
        order: 30,
      }, PromptSuggestionsDock))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'prismflow',
        order: 10,
        inject: () => ({ controller }),
      }, SidebarAction))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'prismflow-dashboard',
        order: 20,
        inject: () => ({ controller }),
      }, DashboardOverlay))
    }
    exports.apply = apply
    exports.inject = inject
    exports.renderMarkdownPreview = renderMarkdownPreview
    exports.safePreviewResourceUrl = safePreviewResourceUrl
    exports.previewMediaUrl = previewMediaUrl
    exports.normalizePublisherConfigBrowser = normalizePublisherConfigBrowser
    exports.canonicalProfileValue = canonicalProfileValue
    exports.publisherRuntimeApplied = publisherRuntimeApplied
    exports.PromptSuggestionsDock = PromptSuggestionsDock
    return module.exports
  },
})
