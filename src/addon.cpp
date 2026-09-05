#include <napi.h>
#include <cstring>
#include "mpv_player.h"

// Packet handed across threads to the JS frame callback
struct FrameData {
    uint8_t *buf; // Buffer::Copy duplicates the contents; the original memory is delete[]'d in the callback
    size_t size;
    int w, h;
};

// Packet handed across threads to the JS event callback
struct EventData {
    std::string eventName;
    bool hasProperty = false;
    std::string propName;
    std::string propValue;
};

class MpvPlayerWrap : public Napi::ObjectWrap<MpvPlayerWrap> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "MpvPlayer", {
            InstanceMethod("init", &MpvPlayerWrap::Init_),
            InstanceMethod("command", &MpvPlayerWrap::Command),
            InstanceMethod("setProperty", &MpvPlayerWrap::SetProperty),
            InstanceMethod("getProperty", &MpvPlayerWrap::GetProperty),
            InstanceMethod("observeProperty", &MpvPlayerWrap::ObserveProperty),
            InstanceMethod("resize", &MpvPlayerWrap::Resize),
            InstanceMethod("destroy", &MpvPlayerWrap::Destroy),
        });
        exports.Set("MpvPlayer", func);
        return exports;
    }

    MpvPlayerWrap(const Napi::CallbackInfo &info) : Napi::ObjectWrap<MpvPlayerWrap>(info) {
        player_ = std::make_unique<MpvPlayer>();
    }

    ~MpvPlayerWrap() { TeardownTsfns(); }

private:
    std::unique_ptr<MpvPlayer> player_;
    Napi::ThreadSafeFunction frameTsfn_;
    Napi::ThreadSafeFunction eventTsfn_;
    bool tsfnsActive_ = false;

    void TeardownTsfns() {
        if (tsfnsActive_) {
            frameTsfn_.Release();
            eventTsfn_.Release();
            tsfnsActive_ = false;
        }
    }

    // init(width, height, onFrame, onEvent) -> boolean
    Napi::Value Init_(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        int width = info[0].As<Napi::Number>().Int32Value();
        int height = info[1].As<Napi::Number>().Int32Value();
        Napi::Function onFrame = info[2].As<Napi::Function>();
        Napi::Function onEvent = info[3].As<Napi::Function>();

        // maxQueueSize=2: when the render thread produces frames faster than JS
        // consumes them, NonBlockingCall drops frames instead of blocking the
        // render thread (dropping fresh frames beats stalling mpv's render).
        frameTsfn_ = Napi::ThreadSafeFunction::New(
            env, onFrame, "MpvFrameCallback", /*maxQueueSize*/ 2, /*initialThreadCount*/ 1);
        eventTsfn_ = Napi::ThreadSafeFunction::New(
            env, onEvent, "MpvEventCallback", 0, 1);
        tsfnsActive_ = true;

        player_->SetFrameCallback([this](const uint8_t *data, size_t size, int w, int h) {
            auto *pkt = new FrameData{};
            pkt->buf = new uint8_t[size];
            std::memcpy(pkt->buf, data, size);
            pkt->size = size;
            pkt->w = w;
            pkt->h = h;

            auto status = frameTsfn_.NonBlockingCall(pkt, [](Napi::Env env, Napi::Function jsCb, FrameData *d) {
                // Electron disables napi_create_external_buffer
                // (NAPI_NO_EXTERNAL_BUFFERS): a zero-copy Buffer over memory we own
                // is not possible (plain Node allows it) — Buffer::Copy is the only
                // option, and the extra copy is a hard constraint of the Electron
                // runtime.
                Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, d->buf, d->size);
                jsCb.Call({buffer, Napi::Number::New(env, d->w), Napi::Number::New(env, d->h)});
                delete[] d->buf;
                delete d;
            });
            if (status != napi_ok) {
                // Queue full — drop the frame: free this allocation, no retry, no blocking
                delete[] pkt->buf;
                delete pkt;
            }
        });

        player_->SetEventCallback([this](mpv_event *event) {
            auto *ed = new EventData{};
            ed->eventName = mpv_event_name(event->event_id);
            if (event->event_id == MPV_EVENT_PROPERTY_CHANGE && event->data) {
                auto *prop = static_cast<mpv_event_property *>(event->data);
                ed->hasProperty = true;
                ed->propName = prop->name;
                if (prop->format == MPV_FORMAT_STRING && prop->data) {
                    ed->propValue = *static_cast<char **>(prop->data);
                } else if (prop->format == MPV_FORMAT_FLAG && prop->data) {
                    ed->propValue = (*static_cast<int *>(prop->data)) ? "true" : "false";
                } else if (prop->format == MPV_FORMAT_DOUBLE && prop->data) {
                    ed->propValue = std::to_string(*static_cast<double *>(prop->data));
                }
            }
            eventTsfn_.NonBlockingCall(ed, [](Napi::Env env, Napi::Function jsCb, EventData *d) {
                Napi::Object obj = Napi::Object::New(env);
                obj.Set("event", d->eventName);
                if (d->hasProperty) {
                    obj.Set("name", d->propName);
                    obj.Set("value", d->propValue);
                }
                jsCb.Call({obj});
                delete d;
            });
        });

        std::string err;
        bool ok = player_->Init(width, height, &err);
        if (!ok) {
            Napi::Error::New(env, err).ThrowAsJavaScriptException();
        }
        return Napi::Boolean::New(env, ok);
    }

    // command(['loadfile', path]) -> boolean
    Napi::Value Command(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        Napi::Array arr = info[0].As<Napi::Array>();
        std::vector<std::string> args;
        for (uint32_t i = 0; i < arr.Length(); i++) {
            args.push_back(arr.Get(i).As<Napi::String>().Utf8Value());
        }
        std::string err;
        bool ok = player_->Command(args, &err);
        if (!ok) Napi::Error::New(env, err).ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, ok);
    }

    Napi::Value SetProperty(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        std::string name = info[0].As<Napi::String>();
        std::string value = info[1].As<Napi::String>();
        std::string err;
        bool ok = player_->SetPropertyString(name, value, &err);
        if (!ok) Napi::Error::New(env, err).ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, ok);
    }

    Napi::Value GetProperty(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        std::string name = info[0].As<Napi::String>();
        std::string value, err;
        if (!player_->GetPropertyString(name, &value, &err)) {
            return env.Null();
        }
        return Napi::String::New(env, value);
    }

    Napi::Value ObserveProperty(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        std::string name = info[0].As<Napi::String>();
        static uint64_t counter = 1;
        bool ok = player_->ObserveProperty(name, MPV_FORMAT_STRING, counter++);
        return Napi::Boolean::New(env, ok);
    }

    Napi::Value Resize(const Napi::CallbackInfo &info) {
        int w = info[0].As<Napi::Number>().Int32Value();
        int h = info[1].As<Napi::Number>().Int32Value();
        player_->Resize(w, h);
        return info.Env().Undefined();
    }

    Napi::Value Destroy(const Napi::CallbackInfo &info) {
        player_->Shutdown();
        TeardownTsfns();
        return info.Env().Undefined();
    }
};

Napi::Object InitAddon(Napi::Env env, Napi::Object exports) {
    return MpvPlayerWrap::Init(env, exports);
}

NODE_API_MODULE(mpv_addon, InitAddon)
