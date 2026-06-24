FROM docker.io/grafana/grafana:12.3.0-18733571275

# Set as root user to copy files and set permissions
USER root

# Copy the built plugin directory to Grafana's plugins directory
COPY dist /var/lib/grafana/plugins/rapidata-sessionreplay-panel

# Set proper permissions

# Allow the unsigned plugin to load
ENV GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=rapidata-sessionreplay-panel

# Switch back to grafana user
USER grafana
