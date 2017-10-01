/*
 * A bonfire is an object that automatically syncs with a firebase database.
 * So, if you change something in the bonfire object, it automatically updates firebase.
 * If another client changes something in firebase, your bonfire will also automatically update.
 *
 * This allows you to easily interact with a scalable and realtime database as if it's a local object.
 *
 * When you create a bonfire you can also get easy to use hooks which can be integrated into your view, or you can use one of Bonfire.js's framework integrations (both features still in development)
 *
 * Bonfire.js is a framework is the JavaScript library that provides this Bonfire data structure
 *
 * Usage:
 * makeBonfire("/path/to/some/location/in/the/database").then(bonfire => {
 *      console.log(bonfire); //=> {foo:"bar"}
 *      bonfire.foo = "baz"
 *      console.log(bonfire); //=> {foo:"baz"}
 * });
 *
 * With the simplicity of changing a regular JavaScript object, we updated changed the value of "foo" on the server from "bar" to "baz" and updated any other clients in real time!
 *
 * So now if some other client was also open, they would notice that their bonfire.foo value also changed!
 *
 *
 * Bonfire makes using firebase extremely fun!
 *
 * ___TODO___
 *
 * todo: implement compareObjects() diffing function
 *  It should return a NodeLocation[] (array of NodeLocations where the two objects differ)
 *  We only care where the object changed, not how (CHANGED, DELETED, ADDED)
 *      Saying that a property is ADDED is the same thing as saying that it's parent node was CHANGED
 *      Saying that a property was DELETED is the same as saying that it's parent was CHANGED
 *
 *
 * todo: implement firebase onValue listener to actually listen to new firebase values, find where the change is, and react accordingly (you need to implement pendingPullUpdates and pendingPushUpdates for this
 *
 * todo: when a user adds a new object to a Bonfire, that object should get bonified as well
 *
 */



//create a private scope
let [makeBonfire] = (() => {

    //=!<>!= Public Methods:

    /**
     * Make a bonfire
     *
     * @param {String} refPath
     * @returns {Promise}
     *
     * @public
     */
    let makeBonfire = function (refPath) {
        return new Promise((resolve, reject) => {
            _checkFirebaseDependency().then(() => {
                let firebaseRef = firebase.database().ref(refPath);
                firebaseRef.once("value", snapshot => {
                    let snapshotValue = snapshot.val();
                    if (_isBonifiable(snapshotValue)) {
                        let bonfire = _bonify(snapshotValue, firebaseRef); // to "bonify" / "bonification" is the process of making a bonfire

                        firebaseRef.on("value", _firebaseOnValueHandler);

                        let a = new _NodeLocation();
                        a.addDepth("foo").addDepth("bar");

                        resolve(bonfire)
                    } else {
                        reject(`Bonfire.js expects the Firebase node to be a non-leaf node (in other words, it should have children). Otherwise the bonfire is useless since there are no children to track!`)
                    }
                });
            }).catch(reject)
        })
    };


    //=!<>!= Private Methods:


    /**
     * Check that firebase is setup / imported properly
     *
     * @returns {Promise.<String>}
     *
     * @private
     */
    let _checkFirebaseDependency = function () {
        return new Promise((resolve, reject) => {
            try {
                //check that the firebase dependency exists in the first place
                if (firebase) {
                    try {
                        //check that the firebase app was initialized
                        if (firebase.apps.length > 0) {
                            resolve();
                        } else {
                            reject("Firebase doesn't seem to be initialized... Did you call firebase.initializeApp? (This might help: https://firebase.google.com/docs/web/setup#add_firebase_to_your_app)")
                        }
                    } catch (err) {
                        reject("An unexpected error occurred while checking if the firebase app has been initialized yet. This should never really happen, so please create a GitHub issue on the Bonfire repo if you get this error!\n\n" + err)
                    }
                }
            } catch (err) {
                reject("The firebase dependency seems to be missing or broken... Did you include firebase.js? (This might help: https://firebase.google.com/docs/web/setup#add_firebase_to_your_app) \n\nHere's the original error - " + err);
            }
        })
    };

    //create another private scope
    //this is a private scope inside a private scope
    //in this private scope we expose 2 methods: _makeSetHandler and _b
    let [_makeSetHandler, _firebaseOnValueHandler] = (()=> {

        let __pendingPullUpdates = [];
        let __pendingPushUpdates = [];

        function __makeSetHandler(rootRef, nodeLocation) {
            return function (target, property, value) {
                console.log("!-! Set trap");
                console.log('set - property:', property);
                console.log('set - value:', value);
                console.log('set - typeof value:', typeof value);
                console.log('rootRef:', rootRef);
                console.log('nodeLocation:', nodeLocation);
                console.log('nodeLocation.toFirebasePath():', nodeLocation.toFirebasePath());
                console.log('!   __pendingPullUpdates:',__pendingPullUpdates);
                console.log('!   __pendingPushUpdates:',__pendingPushUpdates);
                console.log("committing to firebase...");
                console.time("Firebase commit");
                console.log("commented out");
                console.log(`rootRef.child(nodeLocation.toFirebasePath()).child(property).set(value).then(function(){
                                console.log("done committing firebase");
                                console.timeEnd("Firebase commit")
                            });`);
                debugger;
                /* rootRef.child(nodeLocation.toFirebasePath()).child(property).set(value).then(function(){
                     console.log("done committing firebase");
                     console.timeEnd("Firebase commit")
                 });*/
                target[property] = value;
            }
        }

        function __firebaseOnValueHandler(snapshot) {
            __pendingPullUpdates.push({
                value: snapshot.val()
            });
            console.log('__pendingPullUpdates:',__pendingPullUpdates);
            console.log('__pendingPushUpdates:',__pendingPushUpdates);
        }

        return [__makeSetHandler, __firebaseOnValueHandler]
    })();


    /**
     * Create a bonfire from an object (given some data)
     *
     * @param {Object} node
     * @param {firebase.Reference} rootFirebaseRef
     * @param {_NodeLocation} nodeLocation
     *
     * @private
     */
    let _bonify = function (node, rootFirebaseRef, nodeLocation = new _NodeLocation()) {
        let newProxy = _createBonfireProxy(node, rootFirebaseRef, nodeLocation);

        //for each childNode in the node
        for (let childNodeKey in node) {
            let childNode = node[childNodeKey];
            if (_isBonifiable(childNode)) {
                let childNodeLocation = nodeLocation.childNodeLocation(childNodeKey);
                node[childNodeKey] = _bonify(childNode, rootFirebaseRef, childNodeLocation)
            }
        }
        return newProxy;
    };

    /**
     * Check if something is "bonifiable" (able to be bonified)
     * Not all things are bonifiable. Namely, non-object values such as strings and numbers.
     *
     * Note: Arrays are typeof "object" in JavaScript
     *
     * @param {*} thingToCheck
     * @returns {boolean}
     *
     * @private
     */
    let _isBonifiable = function (thingToCheck) {
        return typeof thingToCheck === "object";
    };


    /**
     * Make a bonfire proxy for an object
     *
     * @param {Object} object
     * @param {firebase.Reference} rootRef
     * @param {_NodeLocation} nodeLocation
     * @returns {Proxy}
     *
     * @private
     */
    let _createBonfireProxy = function (object, rootRef, nodeLocation) {
        return new Proxy(object, {set: _makeSetHandler(rootRef, nodeLocation)});
    };

    /**
     * The _NodeLocation class contains a useful wrapper / abstractions aground the idea of "location array",  as well as useful methods for dealing with them.
     * @private
     */
    class _NodeLocation {
        /**
         * NodeLocation constructor
         * @param initialLocationArray - The initial location array, where [] represents the root node, and ["foo","bar"] represents root.foo.bar
         */
        constructor(initialLocationArray = []) {
            this.locationArray = initialLocationArray.slice() //slice() returns a copy of array, to avoid issues with JS pass-by-reference when using arrays (it's like de-referencing a pointer)
        }

        /**
         * Add another level of depth, set the current NodeLocation to be the location of one of the node's children
         * @param {String} key - the key of the child node depth you with to add
         */
        addDepth(key) {
            this.locationArray.push(key);

            let chainObj = {};
            chainObj.addDepth = this.addDepth.bind(this);
            return chainObj //allows chaining addDepth calls
        }

        /**
         * Use the NodeLocation to traverse an object and retrieve the value of that object at this NodeLocation
         * @param {Object} object
         * @returns {*}
         */
        findInObject(object) {
            let result = object;
            this.locationArray.forEach(location => {
                result = result[location];
            });
            return result;
        }

        /**
         * Find the NodeLocation of this node's child
         * @param {String} childNodeKey - the key of the node's child who's NodeLocation you wish to find
         * @returns {_NodeLocation}
         */
        childNodeLocation(childNodeKey) {
            let childNodeLocation = new _NodeLocation(this.locationArray);
            childNodeLocation.addDepth(childNodeKey);
            return childNodeLocation;
        }

        /**
         * Converts a NodeLocation to a firebase path (firebase takes URL style paths as parameters)
         * @example new NodeLocation(["foo","bar"]).toFirebasePath() //=> "/foo/bar"
         * @returns {string}
         */
        toFirebasePath() {
            return "/" + this.locationArray.join("/")
        }
    }

    //expose all public methods
    return [makeBonfire];
})();


//test stuff out
let app;
makeBonfire("/").then(bonfire => {
    //I'm making it global to make console debugging easier
    app = bonfire;
    console.log('app:', app);
});
