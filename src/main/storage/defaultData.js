const OWNER_DEFAULTS = {
    username: 'jldems',
    password: '0925'
};

function createDefaults() {
    return {
        games: [],
        owner: { ...OWNER_DEFAULTS }
    };
}

module.exports = { OWNER_DEFAULTS, createDefaults };
