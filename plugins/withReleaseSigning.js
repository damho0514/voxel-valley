// Signs Android release builds with our private key instead of the template's public debug key
// (anyone holding the debug key could ship a fake "update" over the installed app).
// The key never enters the repo: it lives in ~/.damho-keys/<name>.jks with its passwords in
// ~/.damho-keys/<name>.properties. Without that file, release builds fail instead of silently
// falling back to the debug key.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = 'damhoReleaseSigning';

module.exports = function withReleaseSigning(config, { name }) {
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    if (g.includes(MARK)) return c;
    const signing = `signingConfigs {
        // ${MARK}: private release key, kept outside the repo.
        def damhoKeys = new File(System.getProperty('user.home'), '.damho-keys/${name}.properties')
        if (damhoKeys.exists()) {
            def p = new Properties()
            damhoKeys.withInputStream { p.load(it) }
            release {
                storeFile new File(p['storeFile'])
                storePassword p['storePassword']
                keyAlias p['keyAlias']
                keyPassword p['keyPassword']
            }
        }
`;
    if (!/signingConfigs \{\n/.test(g)) throw new Error('withReleaseSigning: signingConfigs block not found');
    g = g.replace(/signingConfigs \{\n/, signing);
    const release = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!release.test(g)) throw new Error('withReleaseSigning: release signingConfig not found');
    g = g.replace(release, `$1signingConfig signingConfigs.findByName('release') ?: signingConfigs.debug`);
    g += `
// ${MARK}: never ship a release signed with the public debug key.
gradle.taskGraph.whenReady { graph ->
    def keys = new File(System.getProperty('user.home'), '.damho-keys/${name}.properties')
    if (!keys.exists() && graph.allTasks.any { it.name ==~ /(?i).*(assemble|bundle|package)Release.*/ }) {
        throw new GradleException("Release signing key missing: " + keys + " (see plugins/withReleaseSigning.js)")
    }
}
`;
    c.modResults.contents = g;
    return c;
  });
};
